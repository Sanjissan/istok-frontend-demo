// frontend/js/api.js
(function () {
  const STORAGE_KEY = "pt_api_base_url";

  function cleanBase(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function resolveBase() {
    // 1) config.js — главный источник ("" => same-origin, то есть CloudFront)
    if (window.APP_CONFIG && typeof window.APP_CONFIG.API_BASE_URL === "string") {
      return cleanBase(window.APP_CONFIG.API_BASE_URL);
    }

    // 2) localStorage (для отладки)
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage) return cleanBase(fromStorage);

    // 3) fallback — relative (same-origin)
    return "";
  }

  async function fetchJSON(pathOrUrl, opts = {}) {
    const base = resolveBase();
    const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${base}${pathOrUrl}`;

    const method = String(opts.method || "GET").toUpperCase();
    const isGetLike = method === "GET" || method === "HEAD";

    const headers = {
      ...(opts.headers || {}),
    };

    // Для GET/HEAD просим не кэшировать
    if (isGetLike) {
      headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
      headers["Pragma"] = "no-cache";
    }

    // Если есть body и не задан Content-Type — ставим JSON
    if (opts.body != null && headers["Content-Type"] == null) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
      ...opts,
      method,
      cache: "no-store",
      headers,
    });

    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (!res.ok) {
      const msg = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`API error ${res.status}: ${msg}`);
    }

    return body;
  }

  // ===== API =====

  function getRuns(limit = 5000) {
    // _=Date.now() на всякий случай, если где-то сидит странный proxy cache
    return fetchJSON(`/api/runs?limit=${Number(limit) || 1000}&_=${Date.now()}`);
  }

  function getRackProcessStatus(limit = 20000) {
    // IMPORTANT: /api/views/v_rack_process_status LIMIT 200 без ORDER BY может не включать нужные строки
    return getRuns(limit);
  }

  function updateRunStatus(arg1, arg2) {
    // Backwards-compatible:
    // - updateRunStatus({ rack_process_run_id, status_id, note, ... })
    // - updateRunStatus(rack_process_run_id, { status_id, note, ... })
    let payload;

    if (
      (typeof arg1 === "number" || typeof arg1 === "string") &&
      arg2 &&
      typeof arg2 === "object"
    ) {
      payload = { rack_process_run_id: Number(arg1), ...arg2 };
    } else {
      payload = arg1;
    }

    return fetchJSON(`/api/runs/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  window.PT_API = {
    fetchJSON,
    getRuns,
    getRackProcessStatus,
    updateRunStatus,
    resolveBase,
    STORAGE_KEY,
  };
})();
