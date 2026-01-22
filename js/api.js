// frontend/js/api.js
(function () {
  const STORAGE_KEY = "pt_api_base_url";

  function cleanBase(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function resolveBase() {
    if (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) {
      return cleanBase(window.APP_CONFIG.API_BASE_URL);
    }
    if (window.API_BASE) return cleanBase(window.API_BASE);

    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage) return cleanBase(fromStorage);

    return "http://localhost:3000";
  }

  async function fetchJSON(pathOrUrl, opts = {}) {
    const base = resolveBase();
    const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${base}${pathOrUrl}`;

    const res = await fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        "Content-Type": "application/json",
      },
    });

    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      throw new Error(
        `API error ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`
      );
    }
    return body;
  }

  // --- NEW: runs endpoints ---
  async function getRuns(limit = 1000) {
    return fetchJSON(`/api/runs?limit=${encodeURIComponent(limit)}`);
  }

  // body: { rack_process_run_id, status_id, responsible_employee_id?, note? }
  async function postRunStatus(payload) {
    return fetchJSON("/api/runs/status", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // optional helpers (если у тебя уже есть такие роуты)
  async function getStatuses() {
    return fetchJSON("/api/statuses");
  }

  window.PT_API = {
    fetchJSON,
    resolveBase,
    STORAGE_KEY,

    getRuns,
    postRunStatus,
    getStatuses,
  };
})();
