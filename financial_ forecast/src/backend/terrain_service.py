"""Small adapter between native terrain products and the web server.

C++ owns data parsing/joining, geometry, RichDEM and JSON generation. This
module compiles it, unpacks the needed XLSX XML entries and caches HTTP bytes.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import posixpath
import shutil
import subprocess
import tempfile
import threading
import xml.etree.ElementTree as xml
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = Path(__file__).parent / "terrain"
BUILD_ROOT = PROJECT_ROOT / "build" / "terrain"
NATIVE_BINARY = BUILD_ROOT / ("terrainDEM.exe" if os.name == "nt" else "terrainDEM")
RICHDEM_ROOT = PROJECT_ROOT / "richdem-src"
WORKBOOK_PATH = PROJECT_ROOT / "assets" / "data" / "all-datasets.xlsx"
BOUNDARY_PATH = (
    PROJECT_ROOT
    / "assets"
    / "data"
    / "LPA_JAN_2026_UK_BFC_V2_3368052445060871350 (1) (1).geojson"
)
NATIVE_FLAGS = (
    "-std=c++17",
    "-O3",
    "-Wall",
    "-Wextra",
    "-Wno-unknown-pragmas",
    "-DRICHDEM_NO_PROGRESS",
)


def native_inputs() -> list[Path]:
    return sorted(
        [
            *SOURCE_ROOT.glob("*.cpp"),
            *SOURCE_ROOT.glob("*.hpp"),
            RICHDEM_ROOT / "src" / "richdem.cpp",
            *(
                path
                for path in (RICHDEM_ROOT / "include").rglob("*")
                if path.suffix in {".hpp", ".h"}
            ),
        ]
    )


def fingerprint(paths: list[Path]) -> str:
    states = [
        (str(path), path.stat().st_size, path.stat().st_mtime_ns) for path in paths
    ]
    return hashlib.sha256(json.dumps([NATIVE_FLAGS, states]).encode()).hexdigest()


def ensure_native_binary() -> Path:
    signature = fingerprint(native_inputs())
    stamp = BUILD_ROOT / "native-build.key"
    if NATIVE_BINARY.is_file() and stamp.is_file() and stamp.read_text() == signature:
        return NATIVE_BINARY
    compiler = shutil.which("g++") or shutil.which("clang++")
    if not compiler:
        raise RuntimeError(
            "Install a C++17 compiler (g++ or clang++) and put it on PATH."
        )
    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            compiler,
            *NATIVE_FLAGS,
            "-isystem",
            str(RICHDEM_ROOT / "include"),
            *map(str, sorted(SOURCE_ROOT.glob("*.cpp"))),
            str(RICHDEM_ROOT / "src" / "richdem.cpp"),
            "-o",
            str(NATIVE_BINARY),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("C++ terrain build failed:\n" + result.stderr)
    stamp.write_text(signature)
    return NATIVE_BINARY


# Named workbook tabs the native pipeline reads, by output file stem.
WORKBOOK_TABS = {"income": "16", "density": "3"}


def unpack_workbook_xml(
    workbook_path: Path, output: Path, tabs: dict[str, str] = WORKBOOK_TABS
) -> tuple[Path, dict[str, Path]]:
    """Resolve named tabs, not internal sheetN.xml files; C++ reads their records."""
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(workbook_path) as workbook:
        sheets = {
            item.get("name"): item
            for item in xml.fromstring(workbook.read("xl/workbook.xml")).findall(
                f".//{ns}sheet"
            )
        }
        relations = xml.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))
        strings_path = output / "strings.xml"
        strings_path.write_bytes(workbook.read("xl/sharedStrings.xml"))
        sheet_paths = {}
        for stem, name in tabs.items():
            tab = sheets.get(name)
            if tab is None:
                raise ValueError(f"Workbook tab {name} ({stem}) is missing.")
            relation_id = tab.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            )
            target = next(
                item.get("Target")
                for item in relations
                if item.get("Id") == relation_id
            )
            sheet = (
                target.lstrip("/")
                if target.startswith("/")
                else posixpath.normpath(posixpath.join("xl", target))
            )
            sheet_paths[stem] = output / f"{stem}.xml"
            sheet_paths[stem].write_bytes(workbook.read(sheet))
    return strings_path, sheet_paths


class TerrainStore:
    """One native product, precompressed response and small indexed chat context."""

    def __init__(self, build_root: Path = BUILD_ROOT):
        self.build_root = build_root
        self._lock = threading.Lock()
        self._response: tuple[bytes, bytes, str] | None = None
        self._facts: dict | None = None
        self._history = None
        self._history_lock = threading.Lock()

    def _build(self, signature: str, history: bool = False) -> None:
        binary = ensure_native_binary()
        self.build_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=self.build_root) as directory:
            temporary = Path(directory)
            strings, sheets = unpack_workbook_xml(WORKBOOK_PATH, temporary)
            product, context = temporary / "terrain.json", temporary / "context.json"
            result = subprocess.run(
                [
                    str(binary),
                    "--history" if history else "--build",
                    str(BOUNDARY_PATH),
                    str(strings),
                    str(sheets["income"]),
                    str(sheets["density"]),
                    str(product),
                    str(context),
                ],
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            if result.returncode:
                raise RuntimeError(
                    "Native data pipeline failed: " + result.stderr.strip()
                )
            (temporary / "terrain.json.gz").write_bytes(
                gzip.compress(product.read_bytes(), compresslevel=6, mtime=0)
            )
            (temporary / "terrain-cache.key").write_text(signature)
            prefix = "history" if history else "terrain"
            for source, target in (
                ("terrain.json.gz", prefix + ".json.gz"),
                ("context.json", prefix + "-context.json"),
                ("terrain-cache.key", prefix + "-cache.key"),
            ):
                (temporary / source).replace(self.build_root / target)

    def _prepare(self) -> None:
        if self._response is not None:
            return
        signature = fingerprint(
            [*native_inputs(), Path(__file__), WORKBOOK_PATH, BOUNDARY_PATH]
        )
        key = self.build_root / "terrain-cache.key"
        compressed_path, context_path = (
            self.build_root / "terrain.json.gz",
            self.build_root / "terrain-context.json",
        )
        try:
            if key.read_text() != signature:
                raise ValueError("Stale terrain cache")
            compressed = compressed_path.read_bytes()
            content = gzip.decompress(compressed)
            facts = json.loads(context_path.read_bytes())
            if not isinstance(facts.get("metadata"), dict) or not isinstance(
                facts.get("authorities"), dict
            ):
                raise TypeError("Invalid terrain context")
        except (OSError, ValueError, TypeError, EOFError, AttributeError):
            self._build(signature)
            compressed = compressed_path.read_bytes()
            content = gzip.decompress(compressed)
            facts = json.loads(context_path.read_bytes())
        self._response = (
            content,
            compressed,
            'W/"' + hashlib.sha256(content).hexdigest() + '"',
        )
        self._facts = facts

    def response(self) -> tuple[bytes, bytes, str]:
        with self._lock:
            self._prepare()
            return self._response

    def metadata(self) -> dict:
        self.response()
        return dict(self._facts["metadata"])

    def history_response(self) -> tuple[bytes, bytes, str]:
        with self._history_lock:
            if self._history is None:
                signature = fingerprint(
                    [*native_inputs(), Path(__file__), WORKBOOK_PATH, BOUNDARY_PATH]
                )
                key = self.build_root / "history-cache.key"
                path = self.build_root / "history.json.gz"
                try:
                    if key.read_text() != signature:
                        raise ValueError("Stale history cache")
                    compressed = path.read_bytes()
                    content = gzip.decompress(compressed)
                    self._history_context = json.loads(
                        (self.build_root / "history-context.json").read_bytes()
                    )
                except (OSError, ValueError, EOFError):
                    self._build(signature, True)
                    compressed = path.read_bytes()
                    content = gzip.decompress(compressed)
                    self._history_context = json.loads(
                        (self.build_root / "history-context.json").read_bytes()
                    )
                self._history = (
                    content,
                    compressed,
                    'W/"' + hashlib.sha256(content).hexdigest() + '"',
                )
            return self._history

    def context(self, selected: object = None, year: object = None) -> dict:
        self.response()
        metadata = self._facts["metadata"]
        facts = {
            key: metadata[key]
            for key in (
                "metric",
                "source_year",
                "method",
                "matched_authorities",
                "population_density",
            )
            if key in metadata
        }
        if isinstance(selected, str) and selected in self._facts["authorities"]:
            facts["selected_authority"] = dict(self._facts["authorities"][selected])
        if year is not None:
            self.history_response()
            year = str(year)
            if not any(year in surface for surface in self._history_context.values()):
                raise ValueError("Unknown historical year")
            facts["source_year"] = year
            facts["historical_note"] = (
                "Recorded nominal income; fixed current boundaries; no inflation adjustment. Missing observations are unavailable."
            )
            if "population_density" in facts:
                facts["population_density"] = {
                    **facts["population_density"],
                    "source_year": year,
                }
            if "selected_authority" in facts:
                for surface, field in (
                    ("income", "income_per_head"),
                    ("density", "population_density"),
                ):
                    facts["selected_authority"][field] = (
                        self._history_context[surface].get(year, {}).get(selected)
                    )
        return facts
