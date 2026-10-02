"""
KubeForge AI Model service.

Thin FastAPI wrapper around app.diagnose.diagnose(): validates the request
shape, calls the retrieval+synthesis pipeline, and returns a typed
response. Also exposes /feedback so the backend can report whether an
applied fix actually worked — see outcomes.py for what that does with it.
Run with:

    uvicorn app.main:app --reload --port 8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.schemas import DiagnoseRequest, DiagnoseResponse, FeedbackRequest
from app.diagnose import diagnose as run_diagnosis
from app.outcomes import record_outcome, all_stats

app = FastAPI(
    title="KubeForge AI Service",
    description="RAG-based diagnosis and remediation-plan generation for Kubernetes node readiness issues.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "kubeforge-ai"}


@app.post("/diagnose", response_model=DiagnoseResponse)
def diagnose_endpoint(req: DiagnoseRequest) -> DiagnoseResponse:
    evidence = [e.model_dump() for e in req.evidence]
    result = run_diagnosis(req.failure_info, evidence)
    return DiagnoseResponse(**result)


@app.post("/feedback")
def feedback_endpoint(req: FeedbackRequest):
    """Called once per applied fix, after the backend knows whether the
    command it ran actually succeeded. Feeds real outcomes back into
    future retrieval scoring — see outcomes.py and retriever.py."""
    record_outcome(req.matched_id, req.success)
    return {"status": "recorded"}


@app.get("/stats")
def stats_endpoint():
    """Every knowledge base entry's real-world track record so far."""
    return all_stats()
