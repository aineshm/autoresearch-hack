const TOKEN_KEY = 'autolab_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  signup: (payload) => request('/auth/signup', { method: 'POST', body: payload }),
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: (token) => request('/auth/me', { token }),
  chat: (messages, token) => request('/chat', { method: 'POST', body: { messages }, token }),
  // Brief agent (L1 intake): one interview step → { action:'ask', question } | { action:'finalize', brief }
  briefStatus: (token) => request('/brief/status', { token }),
  briefNext: (payload, token) => request('/brief/next', { method: 'POST', body: payload, token }),
  // Projects: each has its own uploaded dataset + chats
  projectsList: (token) => request('/projects', { token }),
  projectCreate: (name, token) => request('/projects', { method: 'POST', body: { name }, token }),
  projectGet: (id, token) => request(`/projects/${id}`, { token }),
  projectUpload: (id, filename, csv, token) =>
    request(`/projects/${id}/upload`, { method: 'POST', body: { filename, csv }, token }),
  // Planner: confirmed brief → web research → plan (what TYPE of variables to hunt)
  plannerPlan: (brief, token) => request('/planner/plan', { method: 'POST', body: { brief }, token }),
  // Streaming planner — calls onEvent for each NDJSON event (stage / queries / search / plan);
  // resolves to the final plan. Lets the UI show a live, Perplexity-style research trace.
  plannerPlanStream: async (brief, token, onEvent) => {
    const res = await fetch('/api/planner/plan/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ brief }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Planning failed');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let plan = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'error') throw new Error(evt.error);
        if (evt.type === 'plan') plan = evt.plan;
        onEvent?.(evt);
      }
    }
    return plan;
  },
};
