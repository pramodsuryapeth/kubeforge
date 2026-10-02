/**
 * Validates the AI's diagnosis before anything is allowed to execute.
 * Policy is deliberately simple and centralized here: low risk_level from
 * the AI model is auto-remediable (SAFE); medium/high requires a human to
 * click Approve (RISKY). Tighten ALWAYS_RISKY_ACTIONS to hard-block
 * specific action types regardless of the AI's own risk rating.
 */
const ALWAYS_RISKY_ACTIONS = new Set(['delete_data', 'wipe_etcd', 'reboot_host']);

function evaluateSafety(diagnosis) {
  const hasHardRiskyAction = (diagnosis.remediation_plan || []).some((step) => ALWAYS_RISKY_ACTIONS.has(step.action));

  if (hasHardRiskyAction || diagnosis.risk_level !== 'low') {
    return { classification: 'RISKY', reason: hasHardRiskyAction ? 'Plan includes a destructive/irreversible action' : `AI reported risk_level=${diagnosis.risk_level}` };
  }

  return { classification: 'SAFE', reason: 'Low-risk, reversible change' };
}

module.exports = { evaluateSafety, ALWAYS_RISKY_ACTIONS };
