"""Regression checks: native DEM invariants, income source and HTTP wiring.

Run: python -m unittest discover -s tests/backend -p test_terrain.py
"""

import gzip
import json
import math
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src" / "backend"))
import server as api
import terrain_service as service


class NativeTerrainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary = service.ensure_native_binary()

    def run_native(self, payload):
        return subprocess.run(
            [str(self.binary)],
            input=payload,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )

    def test_constant_income_is_flat(self):
        result = self.run_native("5 5 -2 50 2 55 2\n-1 51 20000\n1 54 20000\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["backend"], "RichDEM")
        self.assertTrue(all(abs(value - 500) < 0.0001 for value in data["values"]))
        self.assertTrue(all(value == 0 for value in data["analysis"]["slope_riserun"]))
        self.assertEqual(data["contours"], [])

    def test_rising_income_produces_contours(self):
        result = self.run_native("40 40 -2 50 2 55 2\n-2 52.5 10000\n2 52.5 40000\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(len(data["values"]), 1600)
        self.assertEqual(data["contour_interval"], 5)
        self.assertEqual(data["analysis"]["backend"], "RichDEM")
        self.assertEqual(len(data["analysis"]["slope_riserun"]), 1600)
        self.assertTrue(
            all(math.isfinite(v) and v >= 0 for v in data["analysis"]["slope_riserun"])
        )
        # Independent Horn slope calculation checks RichDEM's raster wiring
        # and spatial units against the same generated central neighbourhood.
        values, transform = data["values"], data["geotransform"]
        a, b, c = values[19 * 40 + 19 : 19 * 40 + 22]
        d, _, f = values[20 * 40 + 19 : 20 * 40 + 22]
        g, h, i = values[21 * 40 + 19 : 21 * 40 + 22]
        gx = (c + 2 * f + i - a - 2 * d - g) / (8 * abs(transform[1]))
        gy = (g + 2 * h + i - a - 2 * b - c) / (8 * abs(transform[5]))
        self.assertAlmostEqual(
            data["analysis"]["slope_riserun"][20 * 40 + 20],
            math.hypot(gx, gy),
            delta=1e-8,
        )
        self.assertLess(data["values"][20 * 40], data["values"][20 * 40 + 39])
        self.assertTrue(
            all(math.isfinite(v) and 0 <= v <= 1000 for v in data["values"])
        )
        self.assertGreater(len(data["contours"]), 0)
        for contour in data["contours"]:
            self.assertEqual(contour["elevation_m"] % 5, 0)
            for lon, lat in contour["coordinates"]:
                self.assertTrue(-2 <= lon <= 2 and 50 <= lat <= 55)

    def test_invalid_input_fails_without_json(self):
        for payload in ("0 5 -2 50 2 55 0", "5 5 -2 50 2 55 1\n0 52 -1"):
            result = self.run_native(payload)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")


class AssetIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary = service.ensure_native_binary()

    def simplify(self, geometry):
        result = subprocess.run(
            [str(self.binary), "--simplify"],
            input=json.dumps(geometry),
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_chat_context_uses_indexed_native_authority_facts(self):
        data = json.loads(api.TERRAIN.response()[0])
        authority = next(
            feature["properties"]
            for feature in data["features"]
            if feature["properties"]["income_per_head"] is not None
        )
        context = api.TERRAIN.context(authority["authority_code"])
        self.assertEqual(context["selected_authority"], authority)
        self.assertEqual(context["source_year"], "2024")
        self.assertEqual(context["matched_authorities"], 361)
        self.assertNotIn("dem", context)
        self.assertNotIn("selected_authority", api.TERRAIN.context("unknown authority"))

    def test_disk_cache_reuses_data_and_invalidates_changed_assets(self):
        with tempfile.TemporaryDirectory(dir=service.BUILD_ROOT) as directory:
            root = Path(directory)
            source = root / "source.xlsx"
            source.write_bytes(b"source")

            def publish(store, signature):
                (root / "terrain.json.gz").write_bytes(
                    gzip.compress(b'{"features":[]}')
                )
                (root / "terrain-context.json").write_text(
                    '{"metadata":{},"authorities":{}}'
                )
                (root / "terrain-cache.key").write_text(signature)

            with (
                patch.object(service, "WORKBOOK_PATH", source),
                patch.object(
                    service.TerrainStore, "_build", autospec=True, side_effect=publish
                ) as build,
            ):
                service.TerrainStore(root).response()
                service.TerrainStore(root).response()
                self.assertEqual(build.call_count, 1)
                source.write_bytes(b"changed source")
                service.TerrainStore(root).response()
                self.assertEqual(build.call_count, 2)
                (root / "terrain.json.gz").write_bytes(b"broken cache")
                service.TerrainStore(root).response()
                self.assertEqual(build.call_count, 3)

    def test_boundary_simplification_preserves_closed_islands_and_holes(self):
        for radius in (0.0001, 1):
            ring = [
                [
                    radius * math.cos(i * math.tau / 1000),
                    radius * math.sin(i * math.tau / 1000),
                ]
                for i in range(1000)
            ]
            ring.append(ring[0])
            simplified = self.simplify({"type": "Polygon", "coordinates": [ring]})[
                "coordinates"
            ][0]
            self.assertEqual(simplified[0], simplified[-1])
            self.assertGreaterEqual(len(simplified), 4)
            self.assertLess(len(simplified), 150)
        outer = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]
        hole = [[0.5, 0.5], [0.5, 1], [1, 1], [1, 0.5], [0.5, 0.5]]
        geometry = self.simplify({"type": "Polygon", "coordinates": [outer, hole]})
        self.assertEqual(geometry["coordinates"], [outer, hole])

    def read_table(self, stem):
        with tempfile.TemporaryDirectory(dir=service.BUILD_ROOT) as directory:
            strings, sheets = service.unpack_workbook_xml(
                service.WORKBOOK_PATH, Path(directory)
            )
            result = subprocess.run(
                [str(self.binary), "--income", str(strings), str(sheets[stem])],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)

    def test_income_table_is_named_table_16(self):
        income = self.read_table("income")
        self.assertEqual(income["source_year"], "2024")
        self.assertEqual(income["income_by_name"]["hartlepool"], 20080)

    def test_population_density_table_is_named_table_3(self):
        density = self.read_table("density")
        self.assertEqual(density["source_year"], "2025")
        self.assertEqual(density["income_by_name"]["hartlepool"], 1063)
        self.assertEqual(density["income_by_name"]["middlesbrough"], 2836)

    def test_features_carry_population_density(self):
        data = json.loads(api.TERRAIN.response()[0])
        meta = data["metadata"]["population_density"]
        self.assertEqual(meta["source_year"], "2025")
        self.assertGreaterEqual(meta["matched_authorities"], 361)
        densities = [
            feature["properties"]["population_density"]
            for feature in data["features"]
        ]
        self.assertEqual(
            sum(value is not None for value in densities), meta["matched_authorities"]
        )
        self.assertTrue(all(value is None or value > 0 for value in densities))
        self.assertIn("population_density", api.TERRAIN.context())

    def test_http_serves_native_terrain_and_overlay(self):
        server = api.ThreadingHTTPServer(("127.0.0.1", 0), api.TerrainRequestHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            with urlopen(base + "/api/terrain", timeout=120) as response:
                data = json.load(response)
            self.assertEqual(data["metadata"]["engine"], "terrainDEM.cpp")
            self.assertEqual(data["metadata"]["dem_backend"], "RichDEM")
            self.assertEqual(data["metadata"]["data_pipeline"], "dataPipeline.cpp")
            self.assertEqual(data["dem"]["backend"], "RichDEM")
            self.assertEqual(len(data["dem"]["values"]), 200 * 320)
            self.assertTrue(data["dem"]["contours"])
            self.assertEqual(len(data["features"]), 382)
            with urlopen(
                Request(base + "/api/terrain", headers={"Accept-Encoding": "gzip"}),
                timeout=10,
            ) as response:
                self.assertEqual(response.headers["Content-Encoding"], "gzip")
                etag = response.headers["ETag"]
                compressed = response.read()
                self.assertEqual(
                    json.loads(gzip.decompress(compressed))["dem"]["values"],
                    data["dem"]["values"],
                )
                self.assertLess(len(compressed), len(json.dumps(data).encode()) // 2)
            with self.assertRaises(HTTPError) as unchanged:
                urlopen(
                    Request(base + "/api/terrain", headers={"If-None-Match": etag}),
                    timeout=10,
                )
            self.assertEqual(unchanged.exception.code, 304)
            with urlopen(
                Request(base + "/api/terrain", headers={"Accept-Encoding": "gzip;q=0"}),
                timeout=10,
            ) as response:
                self.assertIsNone(response.headers["Content-Encoding"])
                self.assertEqual(len(json.load(response)["features"]), 382)
            for route, expected in (
                ("/", b'type="module"'),
                ("/map/render/terraintexture.js", b"export class TerrainTexture"),
            ):
                with urlopen(base + route, timeout=10) as response:
                    self.assertIn(expected, response.read())
                    if route.endswith(".js"):
                        self.assertEqual(
                            response.headers.get_content_type(), "text/javascript"
                        )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
