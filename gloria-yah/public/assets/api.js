const API_BASE = (window.GLORI_YAH_API_BASE || '') + '/api/v1';

function getToken() { return localStorage.getItem('gy_token'); }
function setToken(t) { localStorage.setItem('gy_token', t); }

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur API (${res.status})`);
  return data;
}
