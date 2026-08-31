const JSON_HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json',
};

function extractError(payload, status) {
  const error = payload?.error;
  const message = typeof error === 'string'
    ? error
    : error?.message || payload?.message || `Request failed with HTTP ${status}`;
  const code = typeof error === 'object' && error !== null
    ? error.code
    : payload?.code;

  return {
    code: code || `HTTP_${status}`,
    message: String(message).slice(0, 500),
  };
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', payload = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(path, {
      ...options,
      headers: options.body
        ? { ...JSON_HEADERS, ...options.headers }
        : { accept: 'application/json', ...options.headers },
    });
  } catch {
    throw new ApiError('Backend is unreachable.', {
      code: 'BACKEND_UNAVAILABLE',
    });
  }

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new ApiError(`Request failed with HTTP ${response.status}`, {
          status: response.status,
          code: `HTTP_${response.status}`,
        });
      }

      throw new ApiError('Backend returned an invalid JSON response.', {
        status: response.status,
        code: 'INVALID_RESPONSE',
      });
    }
  }

  if (!response.ok) {
    const safeError = extractError(payload, response.status);
    throw new ApiError(safeError.message, {
      status: response.status,
      code: safeError.code,
      payload,
    });
  }

  return payload;
}

function post(path, body) {
  return request(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export const apiClient = {
  getHealth: () => request('/health'),
  getModels: () => request('/api/models'),
  getOllamaHealth: () => request('/api/ollama/health'),
  getAgents: () => request('/api/agents'),
  getAgent: (agentId) => request(`/api/agents/${encodeURIComponent(agentId)}`),
  analyzeTask: (task) => post('/api/router/analyze', { task }),
  planTask: ({ task, workspace }) => post('/api/router/plan', { task, workspace }),
  executeTask: ({ task, workspace }) => post('/api/tasks/execute', { task, workspace }),
  competeTask: ({ task, workspace, agents }) => post('/api/tasks/compete', {
    task,
    workspace,
    ...(agents ? { agents } : {}),
  }),
  getCandidate: (taskId) => request(`/api/tasks/${encodeURIComponent(taskId)}/candidate`),
  approveCandidate: (taskId, expectedFingerprint) => post(
    `/api/tasks/${encodeURIComponent(taskId)}/approve`,
    { expectedFingerprint },
  ),
  rejectCandidate: (taskId) => post(`/api/tasks/${encodeURIComponent(taskId)}/reject`, {}),
  getHistory: (limit = 20) => request(`/api/history/tasks?limit=${encodeURIComponent(limit)}`),
  getHistoryTask: (taskId) => request(`/api/history/tasks/${encodeURIComponent(taskId)}`),
  getAgentPerformance: (agentId) => request(`/api/performance/agents/${encodeURIComponent(agentId)}`),
  getCategoryPerformance: (agentId, category) => request(
    `/api/performance/agents/${encodeURIComponent(agentId)}/categories/${encodeURIComponent(category)}`,
  ),
};
