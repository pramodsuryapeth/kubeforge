const BASE_URL = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (res.status === 204) return null;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(body.error || `Request failed with ${res.status}`);
  }

  return body;
}

/**
 * Opens a live SSE stream for a pipeline action.
 *
 * Supported actions:
 * - connection/check
 * - discovery/run
 * - setup/start
 * - setup/approve
 * - rollback
 *
 * The backend can send:
 * - log
 * - status
 * - execution_state
 * - done
 * - error
 */
export function streamAction(
  id,
  action,
  {
    onLog,
    onStatus,
    onExecutionState,
    onDone,
    onError,
  } = {},
) {
  const es = new EventSource(
    `${BASE_URL}/projects/${id}/${action}/stream`,
  );

  es.onmessage = (event) => {
    let msg;

    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === 'log') {
      onLog?.(msg.entry);
    } else if (msg.type === 'status') {
      onStatus?.(msg.status);
    } else if (msg.type === 'execution_state') {
      onExecutionState?.(msg.executionState);
    } else if (msg.type === 'done') {
      onDone?.(msg.project);
      es.close();
    } else if (msg.type === 'error') {
      onError?.(msg.message);
      es.close();
    }
  };

  es.onerror = () => {
    onError?.('Connection to the server was lost');
    es.close();
  };

  return es;
}

export const api = {
  listProjects: () => request('/projects'),

  getProject: (id) =>
    request(`/projects/${id}`),

  createProject: (payload) =>
    request('/projects', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteProject: (id) =>
    request(`/projects/${id}`, {
      method: 'DELETE',
    }),

  getAudit: (id) =>
    request(`/audit/${id}`),

  listCredentials: () =>
    request('/vault/credentials'),

  createCredential: (payload) =>
    request('/vault/credentials', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};