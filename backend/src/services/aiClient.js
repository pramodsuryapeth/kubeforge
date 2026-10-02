const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000';

/**
 * Sends current state + failure info + evidence + K8s requirements to the
 * KubeForge AI model and returns { root_cause, explanation,
 * remediation_plan, confidence, risk_level, matched_knowledge, matched_id }.
 */
async function diagnose({ vmName, currentState, desiredState, issue, evidence }) {
  const requestBody = {
    vm_name: vmName,
    current_state: currentState,
    kubernetes_requirements: desiredState,
    failure_info: issue.description,
    evidence,
  };

  // ============================
  // AI REQUEST DEBUG LOGS
  // ============================
  console.log('\n========================================');
  console.log('[AI DEBUG] DIAGNOSIS REQUEST');
  console.log('========================================');
  console.log('[AI DEBUG] URL:', `${AI_SERVICE_URL}/diagnose`);
  console.log('[AI DEBUG] Method: POST');
  console.log('[AI DEBUG] Request Body:');
  console.log(JSON.stringify(requestBody, null, 2));
  console.log('========================================\n');

  try {
    const startTime = Date.now();

    const res = await fetch(`${AI_SERVICE_URL}/diagnose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const duration = Date.now() - startTime;

    console.log('\n========================================');
    console.log('[AI DEBUG] DIAGNOSIS HTTP RESPONSE');
    console.log('========================================');
    console.log('[AI DEBUG] Status:', res.status);
    console.log('[AI DEBUG] Status Text:', res.statusText);
    console.log('[AI DEBUG] Response Time:', `${duration} ms`);
    console.log('========================================\n');

    if (!res.ok) {
      const text = await res.text().catch(() => '');

      console.error('\n========================================');
      console.error('[AI DEBUG] DIAGNOSIS FAILED');
      console.error('========================================');
      console.error('[AI DEBUG] Status:', res.status);
      console.error('[AI DEBUG] Error Response:', text);
      console.error('========================================\n');

      const err = new Error(
        `AI service returned ${res.status}: ${text}`
      );

      err.status = 502;
      throw err;
    }

    const aiResponse = await res.json();

    // ============================
    // AI RESPONSE DEBUG LOGS
    // ============================
    console.log('\n========================================');
    console.log('[AI DEBUG] AI DIAGNOSIS RESPONSE');
    console.log('========================================');
    console.log(JSON.stringify(aiResponse, null, 2));
    console.log('========================================');

    console.log('[AI DEBUG] Root Cause:', aiResponse.root_cause);
    console.log('[AI DEBUG] Explanation:', aiResponse.explanation);
    console.log(
      '[AI DEBUG] Remediation Plan:',
      JSON.stringify(aiResponse.remediation_plan, null, 2)
    );
    console.log('[AI DEBUG] Confidence:', aiResponse.confidence);
    console.log('[AI DEBUG] Risk Level:', aiResponse.risk_level);
    console.log(
      '[AI DEBUG] Matched Knowledge:',
      JSON.stringify(aiResponse.matched_knowledge, null, 2)
    );
    console.log('[AI DEBUG] Matched ID:', aiResponse.matched_id);
    console.log('========================================\n');

    return aiResponse;
  } catch (err) {
    console.error('\n========================================');
    console.error('[AI DEBUG] DIAGNOSIS EXCEPTION');
    console.error('========================================');
    console.error('[AI DEBUG] Message:', err.message);
    console.error('[AI DEBUG] Stack:', err.stack);
    console.error('========================================\n');

    throw err;
  }
}

/**
 * Reports whether an applied fix actually worked.
 */
async function reportOutcome({ matchedId, success }) {
  if (!matchedId) {
    console.log(
      '[AI DEBUG] Feedback skipped: matchedId is not available'
    );
    return;
  }

  const feedbackBody = {
    matched_id: matchedId,
    success,
  };

  console.log('\n========================================');
  console.log('[AI DEBUG] FEEDBACK REQUEST');
  console.log('========================================');
  console.log('[AI DEBUG] URL:', `${AI_SERVICE_URL}/feedback`);
  console.log('[AI DEBUG] Request Body:');
  console.log(JSON.stringify(feedbackBody, null, 2));
  console.log('========================================\n');

  try {
    const res = await fetch(`${AI_SERVICE_URL}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedbackBody),
    });

    console.log('\n========================================');
    console.log('[AI DEBUG] FEEDBACK RESPONSE');
    console.log('========================================');
    console.log('[AI DEBUG] Status:', res.status);
    console.log('[AI DEBUG] Status Text:', res.statusText);

    if (!res.ok) {
      const text = await res.text().catch(() => '');

      console.warn('[AI DEBUG] Feedback response body:', text);
    } else {
      console.log('[AI DEBUG] Feedback reported successfully');
    }

    console.log('========================================\n');
  } catch (err) {
    // Feedback failure must not break setup flow.
    console.warn(
      `Could not report outcome to AI service (non-fatal): ${err.message}`
    );
  }
}

module.exports = {
  diagnose,
  reportOutcome,
  AI_SERVICE_URL,
};