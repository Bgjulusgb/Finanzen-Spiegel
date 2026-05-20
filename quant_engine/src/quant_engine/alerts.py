"""Smart-Alert-Engine.

Reagiert auf:
- extreme Sentiment-Sprunge
- Hype-Wellen / News-Spikes
- Panik-Risiko
- politische Eskalationen
- Volatilitaetsausbrueche

Cooldown verhindert Dauerfeuer.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

_LAST_ALERT_AT: dict[str, datetime] = {}


def _cool_down(key: str, minutes: int) -> bool:
    if minutes <= 0:
        return False
    now = datetime.now(timezone.utc)
    last = _LAST_ALERT_AT.get(key)
    if last and (now - last).total_seconds() < minutes * 60:
        return True
    _LAST_ALERT_AT[key] = now
    return False


def _add(out: list[dict[str, Any]], *, type_: str, severity: float, title: str, message: str, payload: dict[str, Any] | None = None, cooldown_min: int = 30) -> None:
    if _cool_down(type_, cooldown_min):
        return
    out.append(
        {
            "type": type_,
            "severity": round(max(0.0, min(1.0, severity)), 3),
            "title": title,
            "message": message,
            "payload": payload or {},
            "ts_utc": datetime.now(timezone.utc).isoformat(),
        }
    )


def detect_alerts(snapshot: dict[str, Any], cfg: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    cooldown = int(cfg.get("cooldown_minutes", 30))

    sentiment = snapshot.get("sentiment", {})
    series = sentiment.get("series_daily", []) or []
    if len(series) >= 2:
        delta = float(series[-1]["score"]) - float(series[-2]["score"])
        if abs(delta) >= float(cfg.get("sentiment_jump", 25)):
            severity = min(1.0, abs(delta) / 100.0)
            direction = "rauf" if delta > 0 else "runter"
            _add(
                out,
                type_="sentiment_jump",
                severity=severity,
                title=f"Sentiment-Sprung {direction} ({delta:+.1f})",
                message=f"Tages-Sentiment hat sich um {delta:+.1f} Punkte veraendert.",
                payload={"delta": delta},
                cooldown_min=cooldown,
            )

    momentum = snapshot.get("momentum", {})
    if momentum.get("spike_detected"):
        z = float(momentum.get("latest_z", 0.0))
        _add(
            out,
            type_="news_spike",
            severity=min(1.0, z / 5.0),
            title=f"News-Spike (z={z:.2f})",
            message="Erwaehnungsvolumen liegt signifikant ueber Normalniveau.",
            payload={"z": z},
            cooldown_min=cooldown,
        )

    vol = snapshot.get("volatility", {})
    if float(vol.get("panic_probability", 0.0)) >= float(cfg.get("panic_threshold", 0.75)):
        p = float(vol["panic_probability"])
        _add(
            out,
            type_="panic_risk",
            severity=p,
            title=f"Erhoehtes Panik-Risiko (P={p:.2f})",
            message="Volatilitaet + negatives Sentiment indizieren erhoehte Panikwahrscheinlichkeit.",
            payload={"panic": p},
            cooldown_min=cooldown,
        )
    if float(vol.get("hype_probability", 0.0)) >= float(cfg.get("hype_threshold", 0.75)):
        h = float(vol["hype_probability"])
        _add(
            out,
            type_="hype",
            severity=h,
            title=f"Hype-Anstieg (P={h:.2f})",
            message="Aktuelle Indikatoren deuten auf erhoehte Hype-Wahrscheinlichkeit hin.",
            payload={"hype": h},
            cooldown_min=cooldown,
        )

    sigma_daily_pct = float(vol.get("sigma_daily", 0.0)) * 100.0
    if sigma_daily_pct >= float(cfg.get("volatility_threshold_pct", 5.0)):
        _add(
            out,
            type_="volatility_breakout",
            severity=min(1.0, sigma_daily_pct / 15.0),
            title=f"Volatilitaetsausbruch ({sigma_daily_pct:.2f}% Tagesvol)",
            message="Tages-Standardabweichung der Renditen liegt ueber dem konfigurierten Schwellenwert.",
            payload={"sigma_daily_pct": sigma_daily_pct},
            cooldown_min=cooldown,
        )

    political = snapshot.get("political_risk", {})
    if float(political.get("score", 0.0)) >= float(cfg.get("political_risk_threshold", 60)):
        score = float(political["score"])
        _add(
            out,
            type_="political_escalation",
            severity=score / 100.0,
            title=f"Politisches Risiko hoch ({score:.0f}/100)",
            message="Politische / geopolitische Ereignisse mit hoher Asset-Exposure erkannt.",
            payload={"score": score, "top": political.get("breakdown", [])[:3]},
            cooldown_min=cooldown,
        )

    return out
