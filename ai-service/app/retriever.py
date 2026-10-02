"""
Retrieval half of the RAG pipeline. Indexes every KNOWLEDGE_BASE entry as a
short document (title + keywords + root cause) and ranks entries against a
query built from the failure description + evidence. Uses TF-IDF cosine
similarity when scikit-learn is available, and falls back to a plain
keyword-overlap score otherwise so the service still runs in a minimal
environment.

Ranking also gets a bounded adjustment from real outcome history (see
outcomes.py): an entry whose fix has actually failed repeatedly in the
field ranks a bit lower than an equally-text-matching entry that's
actually worked, and vice versa. Text relevance still dominates — the
adjustment factor is bounded to roughly 0.5x-1.5x — this is a tiebreaker
informed by real experience, not a replacement for matching the evidence.
"""
from app.knowledge_base import KNOWLEDGE_BASE
from app.outcomes import success_rate

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    _SKLEARN_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only without sklearn installed
    _SKLEARN_AVAILABLE = False


def _doc_text(entry: dict) -> str:
    return f"{entry['title']} {' '.join(entry['keywords'])} {entry['root_cause']}"


_DOCS = [_doc_text(entry) for entry in KNOWLEDGE_BASE]

if _SKLEARN_AVAILABLE:
    _vectorizer = TfidfVectorizer(stop_words="english")
    _doc_matrix = _vectorizer.fit_transform(_DOCS)


def _keyword_overlap_score(query: str, doc: str) -> float:
    q_tokens = set(query.lower().split())
    d_tokens = set(doc.lower().split())
    if not q_tokens or not d_tokens:
        return 0.0
    return len(q_tokens & d_tokens) / len(q_tokens | d_tokens)


def _outcome_adjusted(raw_score: float, kb_id: str) -> float:
    return raw_score * (0.5 + success_rate(kb_id))


def retrieve(query: str, top_k: int = 3):
    """Returns up to top_k (kb_entry, score) pairs, highest score first, score > 0 only. `score` is the outcome-adjusted score used for ranking; callers that want the raw text-match confidence can recompute it from the entry."""
    if _SKLEARN_AVAILABLE:
        query_vec = _vectorizer.transform([query])
        raw_scores = cosine_similarity(query_vec, _doc_matrix)[0]
    else:
        raw_scores = [_keyword_overlap_score(query, doc) for doc in _DOCS]

    adjusted = [
        (entry, float(raw), _outcome_adjusted(float(raw), entry["id"]))
        for entry, raw in zip(KNOWLEDGE_BASE, raw_scores)
    ]
    ranked = sorted(adjusted, key=lambda triple: triple[2], reverse=True)
    return [(entry, adj_score) for entry, _raw_score, adj_score in ranked[:top_k] if adj_score > 0]
