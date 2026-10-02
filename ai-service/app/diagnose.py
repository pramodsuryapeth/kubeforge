"""
Synthesis half of the RAG pipeline: retrieve() finds the most relevant
knowledge base entries for the failure, this turns the best match into the
structured { root_cause, remediation_plan, confidence, risk_level } shape
the Safety Engine and Remediation Engine expect.

Deliberately has no FastAPI/pydantic import so it can be unit tested or
reused standalone — main.py is the only place that adapts it to HTTP.
"""
from app.retriever import retrieve


def build_query(failure_info: str, evidence: list) -> str:
    evidence_text = " ".join(
        f"{e.get('command', '')} {e.get('stdout', '')} {e.get('stderr', '')}" for e in evidence
    )
    return f"{failure_info} {evidence_text}"


def diagnose(failure_info: str, evidence: list, top_k: int = 3) -> dict:
    query = build_query(failure_info, evidence)
    results = retrieve(query, top_k=top_k)

    if not results:
        return {
            "root_cause": "Unable to confidently match this failure to a known pattern.",
            "explanation": "No knowledge base entry scored above the relevance threshold for the supplied evidence — this needs manual investigation.",
            "remediation_plan": [
                {"action": "manual_review", "description": "Escalate for manual investigation; evidence has been attached to the audit trail.", "command": None},
            ],
            "confidence": 0.15,
            "risk_level": "medium",
            "matched_knowledge": [],
            "matched_id": None,
        }

    best_entry, best_score = results[0]
    confidence = round(min(0.98, 0.5 + best_score * 0.6), 2)

    return {
        "root_cause": best_entry["root_cause"],
        "explanation": f'Matched knowledge base entry "{best_entry["title"]}" against the supplied evidence (retrieval score {best_score:.2f}).',
        "remediation_plan": best_entry["remediation"],
        "confidence": confidence,
        "risk_level": best_entry["risk_level"],
        "matched_knowledge": [entry["title"] for entry, _ in results],
        "matched_id": best_entry["id"],
    }
