"""Konfigurations-Loader.

Liest ``config/settings.json``, ``config/sources.json``,
``config/assets.json`` und ``config/political_events.json``
und ueberschreibt Asset-Defaults aus Umgebungsvariablen.

Bewusst pydantic-frei gehalten, weil die Konfiguration als
JSON-Dict in den meisten Modulen direkt verwendet wird.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def _project_root() -> Path:
    # src/quant_engine/config.py -> Projekt-Root drei Ebenen hoch.
    return Path(__file__).resolve().parents[2]


def _load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Konfig-Datei nicht gefunden: {path}")
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


@dataclass
class Asset:
    symbol: str
    name: str
    type: str = "stock"
    queries: list[str] = field(default_factory=list)
    sec_cik: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Asset":
        return cls(
            symbol=data["symbol"],
            name=data["name"],
            type=data.get("type", "stock"),
            queries=list(data.get("queries", [data["name"]])),
            sec_cik=data.get("sec_cik"),
        )


@dataclass
class Config:
    settings: dict[str, Any]
    sources: list[dict[str, Any]]
    assets: list[Asset]
    political_events: dict[str, Any]
    project_root: Path
    db_path: Path

    @property
    def active_asset(self) -> Asset:
        symbol = os.getenv("QUANT_ASSET_SYMBOL")
        if symbol:
            for asset in self.assets:
                if asset.symbol == symbol:
                    return asset
            # Unbekanntes Symbol -> dynamisch anlegen.
            name = os.getenv("QUANT_ASSET_NAME", symbol)
            return Asset(symbol=symbol, name=name, queries=[name, symbol])
        return self.assets[0]


def load_config(project_root: Path | None = None) -> Config:
    """Laedt alle JSON-Configs und liefert ein ``Config``-Objekt."""
    root = project_root or _project_root()
    cfg_dir = root / "config"

    settings = _load_json(cfg_dir / "settings.json")
    sources_raw = _load_json(cfg_dir / "sources.json")
    assets_raw = _load_json(cfg_dir / "assets.json")
    political_events = _load_json(cfg_dir / "political_events.json")

    # Asset-Defaults aus Settings in die Default-Liste mergen, falls nicht vorhanden.
    asset_dicts = list(assets_raw["assets"])
    settings_asset = settings.get("asset", {})
    if settings_asset and not any(a["symbol"] == settings_asset["symbol"] for a in asset_dicts):
        asset_dicts.insert(0, settings_asset)

    assets = [Asset.from_dict(a) for a in asset_dicts]

    db_path_str = os.getenv("QUANT_DB_PATH", str(root / "data" / "quant.db"))
    db_path = Path(db_path_str)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    return Config(
        settings=settings,
        sources=sources_raw["sources"],
        assets=assets,
        political_events=political_events,
        project_root=root,
        db_path=db_path,
    )


_cached: Config | None = None


def get_config() -> Config:
    """Cached Config-Singleton (vermeidet wiederholtes JSON-Parsen)."""
    global _cached
    if _cached is None:
        _cached = load_config()
    return _cached


def reset_config_cache() -> None:
    """Fuer Tests: Cache leeren."""
    global _cached
    _cached = None
