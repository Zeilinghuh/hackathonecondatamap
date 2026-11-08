"""Simulation integration, numerical safety and HTTP contract checks."""

import gzip
import json
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src/backend"))
from forecast_service import VARS, ForecastService, validate_inputs
from server import LocalHTTPServer, TerrainRequestHandler

ROOT = Path(__file__).resolve().parents[2]


class ForecastTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.service = ForecastService(ROOT / "assets/data/all-datasets.xlsx")
        cls.baseline = cls.service.run()
        cls.barnet = next(
            i for i, a in enumerate(cls.baseline["areas"]) if a["name"] == "Barnet"
        )

    def test_model_is_finite_bounded_and_preserves_real_missing_history(self):
        d = self.baseline
        self.assertEqual(d["years"][-10:], list(range(2026, 2036)))
        for variable, rows in d["values"].items():
            values = np.array(rows, dtype=float)[:, -10:]
            self.assertFalse(np.isinf(values).any(), variable)
            self.assertTrue((values[np.isfinite(values)] >= 0).all(), variable)
            if variable in {"deaths", "employment"}:
                self.assertTrue((values[np.isfinite(values)] <= 100).all(), variable)
            if variable in {"income", "density"}:
                self.assertTrue(np.isfinite(values).all(), variable)
        # Business-death data starts later; it must never be displayed as zero history.
        self.assertIsNone(d["values"]["deaths"][self.barnet][0])
        self.assertLessEqual(d["source_years"]["income"][self.barnet], 2025)
        json.dumps(d, allow_nan=False)

    def test_all_uk_countries_and_single_year_growth_are_supported(self):
        d = self.baseline
        self.assertEqual(len(d["areas"]), 361)
        for name in ("Scotland", "Wales", "Northern Ireland"):
            region = next(r for r in d["regions"] if r["name"] == name)
            self.assertTrue(any(a["region"] == region["code"] for a in d["areas"]))
        ni = next(i for i, a in enumerate(d["areas"]) if a["code"].startswith("N09"))
        self.assertEqual(d["source_years"]["employment"][ni], 2023)
        self.assertIn("employment", d["areas"][ni]["estimated_inputs"])
        history = d["values"]["employment"][ni][:-10]
        self.assertIsNone(history[d["years"].index(2022)])
        self.assertIsNotNone(d["values"]["employment"][ni][-1])
        scilly = next(
            i for i, a in enumerate(d["areas"]) if a["name"] == "Isles of Scilly"
        )
        self.assertIsNone(d["values"]["employment"][scilly][-1])
        self.assertIsNotNone(d["values"]["income"][scilly][-1])

    def test_local_edit_changes_target_and_keeps_history_and_scale(self):
        code = self.baseline["areas"][self.barnet]["code"]
        edited = self.service.run(area_shocks={code: {"income": 2}})
        b = self.baseline["values"]["income"][self.barnet]
        e = edited["values"]["income"][self.barnet]
        self.assertGreater(e[-10], b[-10])
        self.assertEqual(e[:-10], b[:-10])
        self.assertEqual(edited["variables"], self.baseline["variables"])
        self.assertEqual(edited["inputs"]["area_shocks"], {code: {"income": 2}})
        # Model state is immutable between scenarios.
        self.assertEqual(self.service.run()["values"], self.baseline["values"])

    def test_foreign_investment_edit_reaches_region_and_rate_bias_has_effect(self):
        code = self.baseline["areas"][self.barnet]["code"]
        changed = self.service.run(area_shocks={code: {"fdi": 2}})
        london = lambda d: next(r for r in d["regions"] if r["name"] == "London")[
            "fdi"
        ][-10]
        self.assertGreater(london(changed), london(self.baseline))
        rate = self.service.run(rate_bias=1)
        self.assertNotEqual(rate["rate"], self.baseline["rate"])
        self.assertNotEqual(rate["values"]["income"], self.baseline["values"]["income"])

    def test_rejects_invalid_inputs_and_unmodelled_areas(self):
        for kwargs in (
            {"shocks": []},
            {"shocks": {"income": float("nan")}},
            {"rate_bias": float("inf")},
            {"shocks": {"income": None}},
            {"shocks": {"income": True}},
            {"shocks": {"unknown": 1}},
            {"area_shocks": []},
            {"area_shocks": {"unknown": {"income": 1}}},
            {"rate_bias": 2},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                validate_inputs(**kwargs)
        with self.assertRaises(ValueError):
            self.service.run(area_shocks={"E09000999": {"income": 1}})

    def test_context_uses_verified_scenario_values_and_handles_missing_coverage(self):
        facts = {
            "selected_authority": {
                "authority_code": "LPA-test",
                "authority_name": "Barnet LPA",
                "income_per_head": 999999,
            }
        }
        context = self.service.context(facts, 2026, shocks={"income": 1})
        actual = self.service.run(shocks={"income": 1})["values"]["income"][
            self.barnet
        ][-10]
        self.assertEqual(context["selected_authority"]["income_per_head"], actual)
        self.assertEqual(context["display"], "simulation")
        facts["selected_authority"]["authority_name"] = "A Scottish authority"
        self.assertIsNone(
            self.service.context(facts, 2026)["selected_authority"]["income_per_head"]
        )
        with self.assertRaises(ValueError):
            self.service.context(facts, 2019)

    def test_http_scenario_contract_caching_and_bad_requests(self):
        with patch("server.FORECAST", self.service):
            server = LocalHTTPServer(("127.0.0.1", 0), TerrainRequestHandler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f"http://127.0.0.1:{server.server_port}/api/forecast"
            try:
                with urlopen(
                    Request(url, headers={"Accept-Encoding": "gzip;q=0"})
                ) as response:
                    self.assertIsNone(response.headers.get("Content-Encoding"))
                    etag = response.headers["ETag"]
                    baseline = json.loads(response.read())
                self.assertEqual(baseline["inputs"]["area_shocks"], {})
                with urlopen(
                    Request(url, headers={"Accept-Encoding": "gzip"})
                ) as response:
                    self.assertEqual(response.headers["Content-Encoding"], "gzip")
                    self.assertEqual(
                        json.loads(gzip.decompress(response.read()))["years"],
                        baseline["years"],
                    )
                with self.assertRaises(HTTPError) as result:
                    urlopen(Request(url, headers={"If-None-Match": etag}))
                self.assertEqual(result.exception.code, 304)
                for query in (
                    "shock_income=nan",
                    "shock_income=inf",
                    "rate_bias=2",
                    "area_shocks=[]",
                    "shock_income=1&shock_income=2",
                    "unknown=1",
                ):
                    with (
                        self.subTest(query=query),
                        self.assertRaises(HTTPError) as error,
                    ):
                        urlopen(url + "?" + query)
                    self.assertEqual(error.exception.code, 400)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def test_constant_series_and_zero_correlation_are_safe(self):
        codes = ["E09000003", "E09000004"]
        table = pd.DataFrame(10.0, index=codes, columns=list(range(1991, 2026)))
        names = dict(zip(codes, ["Barnet", "Bexley"]))
        region = pd.DataFrame(10.0, index=["E12000007"], columns=table.columns)

        def load(source, sheet):
            return (region, names) if sheet == "26" else (table, names)

        with (
            patch("forecast_service.pd.ExcelFile"),
            patch("forecast_service._load_keyed", side_effect=load),
        ):
            data = ForecastService(Path("unused.xlsx")).run()
        for variable in VARS:
            self.assertTrue(np.isfinite(data["national"][variable][-10:]).all())


if __name__ == "__main__":
    unittest.main()
