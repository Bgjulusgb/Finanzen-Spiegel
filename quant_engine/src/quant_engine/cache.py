"""In-Memory Cache mit TTL.

Thread-safe einfacher LRU + TTL Cache. Bewusst stdlib-only,
keine externe Abhaengigkeit. Fuer verteilte Setups laesst sich
spaeter Redis dahinter haengen (Schnittstelle stabil gehalten).
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any


class TTLCache:
    """LRU-Cache mit Time-To-Live pro Eintrag."""

    def __init__(self, max_entries: int = 2000, default_ttl: float = 600.0) -> None:
        self._max = max_entries
        self._default_ttl = default_ttl
        self._lock = threading.RLock()
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()

    def _now(self) -> float:
        return time.monotonic()

    def get(self, key: str) -> Any | None:
        with self._lock:
            item = self._store.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at < self._now():
                self._store.pop(key, None)
                return None
            self._store.move_to_end(key)
            return value

    def set(self, key: str, value: Any, ttl: float | None = None) -> None:
        ttl = self._default_ttl if ttl is None else float(ttl)
        with self._lock:
            self._store[key] = (self._now() + ttl, value)
            self._store.move_to_end(key)
            while len(self._store) > self._max:
                self._store.popitem(last=False)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._store)

    def __contains__(self, key: str) -> bool:
        return self.get(key) is not None
