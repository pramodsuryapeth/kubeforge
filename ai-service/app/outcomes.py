"""
Tracks whether each knowledge base entry's suggested fix has actually
worked when applied for real, and turns that history into a scoring
adjustment retriever.py can use. This is the honest, buildable version of
"the AI gets more accurate over time" — not a trained model, just a
record of real outcomes feeding back into retrieval so an entry that
keeps failing stops being confidently recommended.

Persisted as a small local JSON file rather than a database, matching the
AI service's existing self-contained design (no external DB dependency).
"""
import json
import os
import threading

_STORE_PATH = os.path.join(os.path.dirname(__file__), "outcomes.json")
_lock = threading.Lock()


def _load() -> dict:
    if not os.path.exists(_STORE_PATH):
        return {}
    try:
        with open(_STORE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save(data: dict) -> None:
    tmp_path = f"{_STORE_PATH}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp_path, _STORE_PATH)  # atomic on POSIX — avoids a torn write


def record_outcome(kb_id: str, success: bool) -> None:
    """Call once per applied fix, after you know whether it actually worked."""
    if not kb_id:
        return
    with _lock:
        data = _load()
        entry = data.get(kb_id, {"successes": 0, "failures": 0})
        if success:
            entry["successes"] += 1
        else:
            entry["failures"] += 1
        data[kb_id] = entry
        _save(data)


def success_rate(kb_id: str) -> float:
    """Laplace-smoothed success rate — starts at a neutral 0.5 for an untested
    entry rather than 0 or 1, so one early result (lucky or unlucky) can't
    swing it to an extreme; it takes a real pattern across several outcomes
    to meaningfully move the score."""
    data = _load()
    entry = data.get(kb_id)
    if not entry:
        return 0.5
    s, f = entry["successes"], entry["failures"]
    return (s + 1) / (s + f + 2)


def all_stats() -> dict:
    """Every entry's raw counts + computed rate — for the /stats endpoint."""
    data = _load()
    return {
        kb_id: {**counts, "success_rate": round(success_rate(kb_id), 3)}
        for kb_id, counts in data.items()
    }
