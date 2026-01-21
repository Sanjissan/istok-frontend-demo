// frontend/js/api.js
(function () {
  const STORAGE_KEY = "pt_api_base_url";

  function cleanBase(url) {
    return String(url || "")
      .trim()
      .replace(/\/+$/, ""); // убрать trailing slash
  }

  function isFileProtocol() {
    return typeof window !== "undefined" && window.location && window.location.protocol === "file:";
  }

  function resolveBase() {
    // 1) config.js (главный источник)
    const fromConfig = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL;
    if (fromConfig !== undefined && fromConfig !== null) {
      const base = cleanBase(fromConfig);
      // если пусто — значит используем тот же origin и относительные /api/...
      if (base === "") return "";
      return base;
    }

    // 2) старый вариант (если где-то был window.API_BASE)
    if (window.API_BASE) return cleanBase(window.API_BASE);

    // 3) localStorage fallback
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage) return cleanBase(fromStorage);

    // 4) дефолт:
    // - если index.html открыт как file://, относительный fetch не сработает → берем localhost
    // - иначе можно "" (тот же origin)
    if (isFileProtocol()) return "http://localhost:3000";
    return "";
  }

  function buildUrl(pathOrUrl) {
    // Уже абсолютный URL
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

    const base = resolveBase();

    // base == "" → относительный путь (CloudFront / localhost same-origin)
    if (!base) return pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;

    // base задан → склеиваем
    const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${base}${path}`;
  }

  async function fetchJSON(pathOrUrl, opts = {}) {
    const url = buildUrl(pathOrUrl);

    const res = await fetch(url, {
      ...opts,
      headers: {
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
      const msg = typeof body === "string" ? body : JSON.stringify(body);
      throw new Error(`API error ${res.status}: ${msg}`);
    }
    return body;
  }

  // View: статусы по rack+process
  async function getRackProcessStatus() {
    return fetchJSON("/api/views/v_rack_process_status");
  }

  // логи прогонов
  async function getProcessRunLogs() {
    return fetchJSON("/api/views/v_process_run_logs");
  }

  // список рэков (если нужен)
  async function getRacks() {
    return fetchJSON("/api/racks");
  }

  window.PT_API = {
    fetchJSON,
    getRackProcessStatus,
    getProcessRunLogs,
    getRacks,
    resolveBase,
    buildUrl,
    STORAGE_KEY,
  };
})();
