from typing import List, Optional
from pydantic import BaseModel


class EvidenceItem(BaseModel):
    command: str = ""
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0


class DiagnoseRequest(BaseModel):
    vm_name: str
    current_state: dict = {}
    kubernetes_requirements: dict = {}
    failure_info: str
    evidence: List[EvidenceItem] = []


class RemediationStep(BaseModel):
    action: str
    description: str
    command: Optional[str] = None
    rollback: Optional[str] = None


class DiagnoseResponse(BaseModel):
    root_cause: str
    explanation: str
    remediation_plan: List[RemediationStep]
    confidence: float
    risk_level: str  # "low" | "medium" | "high"
    matched_knowledge: List[str]
    matched_id: Optional[str] = None


class FeedbackRequest(BaseModel):
    matched_id: str
    success: bool
