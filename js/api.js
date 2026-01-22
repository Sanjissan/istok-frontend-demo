// frontend/js/api.js
(function () {
  const STORAGE_KEY = "pt_api_base_url";

  function cleanBase(url) {
    return String(url || "")
      .trim()
      .replace(/\/+$/, "");
  }

  function resolveBase() {
    // 1) config.js — главный источник
    if (window.APP_CONFIG && typeof window.APP_CONFIG.API_BASE_URL === "string") {
      return cleanBase(window.APP_CONFIG.API_BASE_URL);
    }

    // 2) localStorage (для отладки)
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage) return cleanBase(fromStorage);

    // 3) fallback — ТОЖЕ relative
    return "";
  }

  async function fetchJSON(pathOrUrl, opts = {}) {
    const base = resolveBase();
    const url =
      pathOrUrl.startsWith("http")
        ? pathOrUrl
        : `${base}${pathOrUrl}`;

    const res = await fetch(url, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
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
        `API error ${res.status}: ${
          typeof body === "string" ? body : JSON.stringify(body)
        }`
      );
    }

    return body;
  }

  // ===== API =====

  function getRuns(limit = 1000) {
    return fetchJSON(`/api/runs?limit=${limit}`);
  }

  function updateRunStatus(payload) {
    return fetchJSON(`/api/runs/status`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  function getRackProcessStatus() {
    return fetchJSON(`/api/views/v_rack_process_status`);
  }

  window.PT_API = {
    fetchJSON,
    getRuns,
    updateRunStatus,
    getRackProcessStatus,
    resolveBase,
  };
})();
