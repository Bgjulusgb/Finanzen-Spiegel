"""Tests fuer den TTL-Cache."""

from __future__ import annotations

import time

from quant_engine.cache import TTLCache


def test_set_and_get():
    c = TTLCache(max_entries=10, default_ttl=60)
    c.set("a", 1)
    assert c.get("a") == 1
    assert "a" in c


def test_ttl_expiry():
    c = TTLCache(max_entries=10, default_ttl=0.01)
    c.set("a", "x")
    time.sleep(0.05)
    assert c.get("a") is None


def test_lru_evicts_oldest():
    c = TTLCache(max_entries=2, default_ttl=60)
    c.set("a", 1)
    c.set("b", 2)
    c.set("c", 3)
    assert c.get("a") is None
    assert c.get("b") == 2
    assert c.get("c") == 3


def test_clear():
    c = TTLCache(max_entries=10, default_ttl=60)
    c.set("a", 1)
    c.set("b", 2)
    c.clear()
    assert len(c) == 0
