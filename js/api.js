// frontend/js/api.js
(function () {
  const STORAGE_KEY = "pt_api_base_url";

  function cleanBase(url) {
    return String(url || "")
      .trim()
      .replace(/\/+$/, ""); // remove trailing slashes
  }

  /**
   * API base resolution order:
   * 1) window.APP_CONFIG.API_BASE_URL (config.js)
   *    - "" -> relative mode, requests go to "/api/..."
   *    - "https://example.com" -> absolute mode, requests go to "https://example.com/api/..."
   * 2) localStorage override (debug)
   * 3) default: "" (relative)
   */
  function resolveBase() {
    if (window.APP_CONFIG && typeof window.APP_CONFIG.API_BASE_URL === "string") {
      return cleanBase(window.APP_CONFIG.API_BASE_URL);
    }

    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage) return cleanBase(fromStorage);

    return "";
  }

  function resolveUrl(pathOrUrl) {
    // already absolute
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

    // ensure leading slash
    const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;

    const base = resolveBase();
    if (!base) return path; // relative mode

    return `${base}${path}`;
  }

  async function fetchJSON(pathOrUrl, opts = {}) {
    const url = resolveUrl(pathOrUrl);

    const res = await fetch(url, {
      // helpful while debugging CloudFront/API cache behavior
      cache: opts.cache ?? "no-store",
      ...opts,
      headers: {
        ...(opts.headers || {}),
        // only set JSON header when we actually send JSON (POST/PUT/PATCH)
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });

    const text = await res.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text; // not json
    }

    if (!res.ok) {
      const msg =
        typeof body === "string"
          ? body
          : body && typeof body === "object"
          ? JSON.stringify(body)
          : "(no body)";
      const err = new Error(`API error ${res.status}: ${msg}`);
      err.status = res.status;
      err.url = url;
      err.body = body;
      throw err;
    }

    return body;
  }

  // ===== API =====

  function getRuns(limit = 1000) {
    const n = Number(limit) || 1000;
    return fetchJSON(`/api/runs?limit=${encodeURIComponent(n)}`);
  }

  function updateRunStatus(payload) {
    return fetchJSON(`/api/runs/status`, {
      method: "POST",
      body: JSON.stringify(payload || {}),
    });
  }

  function getRackProcessStatus() {
    return fetchJSON(`/api/views/v_rack_process_status`);
  }

  // expose
  window.PT_API = {
    STORAGE_KEY,
    cleanBase,
    resolveBase,
    resolveUrl,
    fetchJSON,

    getRuns,
    updateRunStatus,
    getRackProcessStatus,
  };
})();
