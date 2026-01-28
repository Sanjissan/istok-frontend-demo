/* PT_FIX_V20_BACKEND_CODE_OVERRIDE */
/* PT_FIX_V19_DOM_RACK_FALLBACK: robust DOM rack-id mapping + debug helpers */
// js/progress_combined.js
(function () {

// ==========================================================
// PT_FIX_V15: ensure UI reflects backend on reload
// - Clears saved localStorage overrides used for offline UI codes
// - Exposes helpers on window.PT_DEBUG
// ==========================================================
const PT_LS_CLEAR_RE = /^(pt_code|ptcode|pt-status|ptStatus|ptresp|pt_resp|ptselected|pt_selected|ptcache|pt_cache|ptui|pt_ui|ptCode)/i;

function ptClearLocalOverrides() {
  try {
    const keys = Object.keys(localStorage || {});
    for (const k of keys) {
      if (PT_LS_CLEAR_RE.test(k)) localStorage.removeItem(k);
    }
  } catch (e) {}
}
// Clear immediately so backend state becomes the source of truth after refresh
ptClearLocalOverrides();
window.PT_DEBUG = window.PT_DEBUG || {};
window.PT_DEBUG.clearLocalOverrides = ptClearLocalOverrides;
window.PT_DEBUG.listSelectIds = function () {
  try {
    return Array.from(document.querySelectorAll("select")).map(s => ({
      id: s.id || null,
      name: s.name || null,
      className: s.className || null,
      options: s.options ? s.options.length : null
    }));
  } catch (e) { return []; }
};

// PT_FIX_V19: Debug helpers (safe in production; only used from DevTools)
window.PT_DEBUG.getCode = function (suKey, rackId, procKey) {
  try { return getCode(String(suKey), String(rackId), String(procKey)); } catch { return null; }
};
window.PT_DEBUG.lastFetch = function(){ try { return window.PT_DEBUG._lastFetch || null; } catch { return null; } };
window.PT_DEBUG.progressInfo = function () {
  try {
    const keys = Object.keys(PROGRESS || {});
    return { count: keys.length, sample: keys.slice(0, 50) };
  } catch { return { count: 0, sample: [] }; }
};
window.PT_DEBUG.run575 = function () {
  try {
    if (window.PT_API && typeof window.PT_API.getRuns === "function") {
      return window.PT_API.getRuns(5000).then(rows => (rows || []).find(r => Number(r.rack_process_run_id) === 575));
    }
    if (window.PT_REST && typeof window.PT_REST.fetchJSON === "function") {
      return window.PT_REST.fetchJSON("/api/runs?limit=20000&_=" + Date.now()).then(rows => (rows || []).find(r => Number(r.rack_process_run_id) === 575));
    }
  } catch {}
  return Promise.resolve(null);
};

  // ==========================================================
  // 1. API & CONFIG (Back-end Logic)
  //    - Works with window.PT_API if it's injected
  //    - Or via plain REST using APP_CONFIG.API_BASE_URL / localStorage("pt_api_base_url")
  // ==========================================================
  function cleanBase(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function resolveBase() {
    const cfg = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL;
    if (cfg !== undefined && cfg !== null && String(cfg).trim() !== "") return cleanBase(cfg);
    const fromStorage = (() => { try { return localStorage.getItem("pt_api_base_url"); } catch { return ""; } })();
    if (fromStorage) return cleanBase(fromStorage);
    return "";
  }

  async function fetchJSON(pathOrUrl, opts = {}) {
    const base = resolveBase();
    const url = /^https?:\/\//i.test(pathOrUrl)
      ? pathOrUrl
      : (base ? `${base}${pathOrUrl}` : pathOrUrl);

    const res = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      credentials: opts.credentials || "include",
    });

    const text = await res.text();
    const ctype = (res.headers && res.headers.get) ? (res.headers.get("content-type") || "") : "";
    window.PT_DEBUG = window.PT_DEBUG || {};
    window.PT_DEBUG._lastFetch = { url, status: res.status, ok: res.ok, contentType: ctype, preview: String(text || "").slice(0, 200) };
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }

    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    }
    return body;
  }

  async function apiGetRackProcessStatus() {
    if (window.PT_API && typeof window.PT_API.getRackProcessStatus === "function") {
      return window.PT_API.getRackProcessStatus();
    }
    return fetchJSON("/api/runs?limit=20000&_=" + Date.now());
  }

  
  function ptNormalizeRows(payload){
    // Accept array, or {data:[...]}, {rows:[...]}, {result:[...]}
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
      const cand = payload.data || payload.rows || payload.result || payload.items;
      if (Array.isArray(cand)) return cand;
    }
    return [];
  }

  

async function apiUpdateRunStatus(rack_process_run_id, payload = {}) {
    if (window.PT_API && typeof window.PT_API.updateRunStatus === "function") {
      return window.PT_API.updateRunStatus(rack_process_run_id, payload);
    }
    return fetchJSON("/api/runs/status", {
      method: "POST",
      body: JSON.stringify({ rack_process_run_id, ...payload }),
    });
  }

  async function apiGetStatuses() {
    if (window.PT_API && typeof window.PT_API.getStatuses === "function") {
      return window.PT_API.getStatuses();
    }
    return fetchJSON("/api/statuses");
  }

  async function apiGetProcesses() {
    if (window.PT_API && typeof window.PT_API.getProcesses === "function") {
      return window.PT_API.getProcesses();
    }
    return fetchJSON("/api/processes");
  }

  async function apiGetProcessStatuses(processId) {
    if (window.PT_API && typeof window.PT_API.getProcessStatuses === "function") {
      return window.PT_API.getProcessStatuses(processId);
    }
    return fetchJSON(`/api/processes/${processId}/statuses`);
  }


  window.PT_REST = { apiGetRackProcessStatus, apiUpdateRunStatus, apiGetStatuses, apiGetProcesses, apiGetProcessStatuses, fetchJSON, resolveBase };

})();
(function () {
  const T_A_1_7 = { 1:"NOT STARTED", 2:"DRESSING IN PROGRESS", 3:"DRESSING DONE", 4:"PATCHING IN PROGRESS", 5:"PATCHING DONE", 6:"QC DONE", 7:"BLOCKED" };
  const T_B_1_5 = { 1:"NOT STARTED", 2:"IN PROGRESS", 3:"DONE", 4:"QC DONE", 5:"BLOCKED" };
  const T_IPMI_CAT6 = { 1:"NOT STARTED", 2:"PULLING IN PROGRESS", 3:"PATCHING IN PROGRESS", 4:"PATCHING DONE", 5:"TONING IS DONE", 6:"QC DONE", 7:"BLOCKED" };
  const T_GPU_AEC = { 1:"NOT STARTED", 2:"SIS IN PROGRESS", 3:"SIS IS DONE", 4:"FULL SET IN PROGRESS", 5:"FULL SET IS DONE", 6:"QC DONE", 7:"BLOCKED" };

  const PROCESS_TEMPLATES = {
    "ROCE T1: AS-T1/R.T1-T2": T_A_1_7,
    "SU-MS IPMI": T_A_1_7,
    "ROCE T2: R.T1-T2": T_A_1_7,
    "R.T2-T3": T_A_1_7,
    "SIS T1: AS-T1": T_A_1_7,
    "SIS T1-T2": T_A_1_7,

    "IPMI JUMPERS LC-LC": T_B_1_5,
    "MS-MC T1 144F": T_B_1_5,
    "MS-MC NA15/NB15": T_B_1_5,
    "MC-MF NM09-NL09": T_B_1_5,
    "GPU CAT6": T_B_1_5,

    "IPMI CAT6": T_IPMI_CAT6,
    "GPU AEC": T_GPU_AEC,
  };
  const ALL_PROCESSES = Object.keys(PROCESS_TEMPLATES);

  const COMPLETION_CODE = {};
  for (const [proc, tpl] of Object.entries(PROCESS_TEMPLATES)) {
    let qc = null;
    let last = 1;
    for (const [k, label] of Object.entries(tpl)) {
      const code = Number(k);
      if (!Number.isFinite(code)) continue;
      if (label === "BLOCKED") continue;
      if (code > last) last = code;
      if (String(label).toUpperCase().includes("QC DONE")) qc = Math.max(qc ?? 1, code);
    }
    COMPLETION_CODE[proc] = qc ?? last;
  }

  // ---- Strict status colors support ----
  // Convert a human-readable status label to a small set of color keys.
  // The actual HEX values are defined in CSS (strict palette).
function statusLabelToKey(label){
  const t = String(label || "").toLowerCase().trim();

  const keys = new Set(["yellow","orange","cyan","blue","green","red","purple","default"]);
  if (keys.has(t)) return t;
  if (t.includes("done") && t.includes("dressing done")) return "orange";
   if (t.includes("in progress") && t.includes("patching in progress")) return "cyan";
  // 1) system
  if (t.includes("blocked")) return "red";
  if (t.includes("qc")) return "green";
  if (t.includes("toning")) return "purple";

  // 2) SIS
  if (t.includes("sis") && t.includes("in progress")) return "yellow";
  if (t.includes("sis") && (t.includes("is done") || t.endsWith("done") || t.includes(" done"))) return "orange";

  // 3) FULL SET
  if (t.includes("full set") && t.includes("in progress")) return "cyan";
  if (t.includes("full set") && (t.includes("is done") || t.endsWith("done") || t.includes(" done"))) return "blue";

  // 4) fallback
  if (t.includes("in progress")) return "yellow";
  if (t.includes("done")) return "blue";

  return "default";
}


  function statusLabelToDot(label){
    const k = statusLabelToKey(label);
    return ({
      yellow:"🟡",
      orange:"🟠",
      cyan:"🔵",
      blue:"🔷",
      green:"🟢",
      red:"🔴",
      purple:"🟣",
      default:"⚪",
    })[k] || "⚪";
  }

      const PROCESS_BY_TYPE = {
    "SIS T1": ["SIS T1: AS-T1", "SIS T1-T2", "IPMI CAT6"],
    "ROCE T1": ["ROCE T1: AS-T1/R.T1-T2", "SU-MS IPMI", "IPMI JUMPERS LC-LC", "MS-MC T1 144F"],
    "ROCE T2": ["ROCE T2: R.T1-T2", "R.T2-T3", "IPMI CAT6"],
    "GPU": ["GPU AEC", "GPU CAT6"],
    "IPMI MC": ["MS-MC NA15/NB15", "MC-MF NM09-NL09", "IPMI CAT6"],
    "SIS NM": ["IPMI CAT6"],
  };

  const SU_RACKS = { 
"1": [
    { id:"LAC-SU1", name:"LAC", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU1", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "2": [
    { id:"LAH-SU2", name:"LAH", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU2", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "3": [
    { id:"LAM-SU3", name:"LAM", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU3", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "4": [
    { id:"LAR-SU4", name:"LAR", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU4", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "5": [
    { id:"LAW-SU5", name:"LAW", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU5", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "6": [
    { id:"LBB-SU6", name:"LBB", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU6", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "7": [
    { id:"LBG-SU7", name:"LBG", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU7", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "8": [
    { id:"LBL-SU8", name:"LBL", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU8", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "9": [
    { id:"LBQ-SU9", name:"LBQ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU9", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "10": [
    { id:"LBV-SU10", name:"LBV", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU10", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "11": [
    { id:"LCA-SU11", name:"LCA", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU11", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "12": [
    { id:"LCF-SU12", name:"LCF", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU12", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "13": [
    { id:"LCK-SU13", name:"LCK", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU13", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "14": [
    { id:"LCP-SU14", name:"LCP", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU14", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "15": [
    { id:"LCU-SU15", name:"LCU", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU15", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "16": [
    { id:"LCZ-SU16", name:"LCZ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU16", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "17": [
    { id:"LDE-SU17", name:"LDE", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU17", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "18": [
    { id:"LDJ-SU18", name:"LDJ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU18", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "19": [
    { id:"LDO-SU19", name:"LDO", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU19", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "20": [
    { id:"LDT-SU20", name:"LDT", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU20", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "21": [
    { id:"LDY-SU21", name:"LDY", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU21", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "22": [
    { id:"LED-SU22", name:"LED", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU22", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "23": [
    { id:"LEI-SU23", name:"LEI", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU23", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "24": [
    { id:"LEN-SU24", name:"LEN", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU24", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "25": [
    { id:"LES-SU25", name:"LES", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU25", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "26": [
    { id:"LEX-SU26", name:"LEX", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU26", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "27": [
    { id:"LFC-SU27", name:"LFC", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU27", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "28": [
    { id:"LFH-SU28", name:"LFH", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU28", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "29": [
    { id:"LFM-SU29", name:"LFM", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU29", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "30": [
    { id:"LFR-SU30", name:"LFR", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU30", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "31": [
    { id:"LFW-SU31", name:"LFW", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU31", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "32": [
    { id:"LGB-SU32", name:"LGB", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU32", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "33": [
    { id:"LGG-SU33", name:"LGG", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU33", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "34": [
    { id:"LGL-SU34", name:"LGL", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU34", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "35": [
    { id:"LGQ-SU35", name:"LGQ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU35", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "36": [
    { id:"LGV-SU36", name:"LGV", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU36", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "37": [
    { id:"LHA-SU37", name:"LHA", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU37", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "38": [
    { id:"LHF-SU38", name:"LHF", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU38", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "39": [
    { id:"LHK-SU39", name:"LHK", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU39", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "40": [
    { id:"LHP-SU40", name:"LHP", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU40", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "41": [
    { id:"LHU-SU41", name:"LHU", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU41", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "42": [
    { id:"LHZ-SU42", name:"LHZ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU42", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "43": [
    { id:"LIE-SU43", name:"LIE", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU43", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "44": [
    { id:"LIJ-SU44", name:"LIJ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU44", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "45": [
    { id:"LIO-SU45", name:"LIO", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU45", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "46": [
    { id:"LIT-SU46", name:"LIT", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU46", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "47": [
    { id:"LIY-SU47", name:"LIY", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU47", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "48": [
    { id:"LJD-SU48", name:"LJD", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU48", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "49": [
    { id:"LJI-SU49", name:"LJI", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU49", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "50": [
    { id:"LJN-SU50", name:"LJN", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU50", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "51": [
    { id:"LJS-SU51", name:"LJS", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU51", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "52": [
    { id:"LJX-SU52", name:"LJX", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU52", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "53": [
    { id:"LKC-SU53", name:"LKC", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU53", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "54": [
    { id:"LKH-SU54", name:"LKH", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU54", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "55": [
    { id:"LKM-SU55", name:"LKM", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU55", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "56": [
    { id:"LKR-SU56", name:"LKR", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU56", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "57": [
    { id:"LKW-SU57", name:"LKW", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU57", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "58": [
    { id:"LLB-SU58", name:"LLB", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU58", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "59": [
    { id:"LLG-SU59", name:"LLG", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU59", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "60": [
    { id:"LLL-SU60", name:"LLL", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU60", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "61": [
    { id:"LLQ-SU61", name:"LLQ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU61", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "62": [
    { id:"LLV-SU62", name:"LLV", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU62", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "63": [
    { id:"LMA-SU63", name:"LMA", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU63", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "64": [
    { id:"LMF-SU64", name:"LMF", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU64", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "65": [
    { id:"LMK-SU65", name:"LMK", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU65", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "66": [
    { id:"LMP-SU66", name:"LMP", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU66", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "67": [
    { id:"LMU-SU67", name:"LMU", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU67", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "68": [
    { id:"LMZ-SU68", name:"LMZ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU68", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "69": [
    { id:"LNE-SU69", name:"LNE", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU69", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "70": [
    { id:"LNJ-SU70", name:"LNJ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU70", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "71": [
    { id:"LNO-SU71", name:"LNO", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU71", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "72": [
    { id:"LNT-SU72", name:"LNT", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU72", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "73": [
    { id:"LNY-SU73", name:"LNY", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU73", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "74": [
    { id:"LOD-SU74", name:"LOD", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU74", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "75": [
    { id:"LOI-SU75", name:"LOI", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU75", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "76": [
    { id:"LON-SU76", name:"LON", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU76", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "77": [
    { id:"LOS-SU77", name:"LOS", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU77", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "78": [
    { id:"LOX-SU78", name:"LOX", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU78", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "79": [
    { id:"LPC-SU79", name:"LPC", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU79", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "80": [
    { id:"LPH-SU80", name:"LPH", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU80", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "81": [
    { id:"LPM-SU81", name:"LPM", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU81", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "82": [
    { id:"LPR-SU82", name:"LPR", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU82", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "83": [
    { id:"LPW-SU83", name:"LPW", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU83", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "84": [
    { id:"LQB-SU84", name:"LQB", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU84", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "85": [
    { id:"LQG-SU85", name:"LQG", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU85", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "86": [
    { id:"LQL-SU86", name:"LQL", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU86", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "87": [
    { id:"LQQ-SU87", name:"LQQ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU87", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "88": [
    { id:"LQV-SU88", name:"LQV", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU88", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "89": [
    { id:"LRA-SU89", name:"LRA", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU89", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "90": [
    { id:"LRF-SU90", name:"LRF", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []), aliases:["LHM"] },
    { id:"GPU-SU90", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "91": [
    { id:"LRK-SU91", name:"LRK", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU91", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "92": [
    { id:"LRP-SU92", name:"LRP", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU92", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "93": [
    { id:"LRU-SU93", name:"LRU", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU93", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "94": [
    { id:"LRZ-SU94", name:"LRZ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU94", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "95": [
    { id:"LSE-SU95", name:"LSE", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU95", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
  "96": [
    { id:"LSJ-SU96", name:"LSJ", type:"ROCE T1", processes:(PROCESS_BY_TYPE["ROCE T1"] || []) },
    { id:"GPU-SU96", name:"GPU", type:"GPU", processes:(PROCESS_BY_TYPE["GPU"] || []) },
  ],
};

  let SU_GPU_RACKS = null;
  
const CELL_RACKS = { 
    "LU1_ROW12_SIS_T1": [
      { id:"NA29", name:"NA29", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
    ],
    "LU1_ROW12_SIS_NM": [
    { id:"NA05", name:"NA28", type:"SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) },
    ],
    "LU1_ROW13_SIS_T1": [
      { id:"NB29", name:"NB29", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
    ],
    "LU1_ROW13_SIS_NM": [
      { id:"NB28", name:"NB28", type:"SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) },
    ],
    "LU2_ROW12_ROCE_T2_RAIL1": [
      { id:"NA24", name:"NA24", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA25", name:"NA25", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA26", name:"NA26", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA27", name:"NA27", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
    ],
    "LU2_ROW13_ROCE_T2_RAIL1": [
      { id:"NB24", name:"NB24", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB25", name:"NB25", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB26", name:"NB26", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB27", name:"NB27", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
    ],
    "LU3_ROW12_SIS_T1": [
      { id:"NA22", name:"NA22", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
      { id:"NA23", name:"NA23", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
    ],
    "LU3_ROW12_SIS_NM": [
    { id:"NA21", name:"NA21", type:"SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) },
    ],
    "LU3_ROW13_SIS_T1": [
      { id:"NB22", name:"NB22", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
      { id:"NB23", name:"NB23", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
    ],
    "LU3_ROW13_SIS_NM": [
      { id:"NB21", name:"NB21", type:"SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) },
    ],
    "LU4_ROW12_ROCE_T2_RAIL2": [
      { id:"NA17", name:"NA17", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA18", name:"NA18", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA19", name:"NA19", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA20", name:"NA20", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
    ],
    "LU4_ROW13_ROCE_T2_RAIL2": [
      { id:"NB17", name:"NB17", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB18", name:"NB18", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB19", name:"NB19", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB20", name:"NB20", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
    ],
    "LU5_ROW12_IPMI_MC": [
      { id:"NA15", name:"NA15", type:"IPMI MC", processes: (PROCESS_BY_TYPE["IPMI MC"] || []) },
    ],
    "LU5_ROW12_SIS_NM": [
      { id:"NA14", name:"NA14", type:"SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) },
    ],
    "LU5_ROW12_SIS_T1": [
      { id:"NA16", name:"NA16", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
    ],
    "LU5_ROW13_IPMI_MC": [
      { id:"NB15", name:"NB15", type:"IPMI MC", processes: (PROCESS_BY_TYPE["IPMI MC"] || []) },
    ],
    "LU5_ROW13_SIS_NM": [
      { id:"NB14", name:"NB14", type:"SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) },
    ],
    "LU5_ROW13_SIS_T1": [
      { id:"NB16", name:"NB16", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
    ],
    "LU6_ROW12_SIS_T1": [
      { id:"NA12", name:"NA12", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
      { id:"NA13", name:"NA13", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
    ],
    "LU6_ROW12_SIS_NM": [
      { id:"NA11", name:"NA11", type:"SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) },
    ],
    "LU6_ROW13_SIS_T1": [
      { id:"NB12", name:"NB12", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
      { id:"NB13", name:"NB13", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
    ],
    "LU6_ROW13_SIS_NM": [
      { id:"NB11", name:"NB11", type:"SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) },
    ],
    "LU7_ROW12_ROCE_T2_RAIL3": [
      { id:"NA07", name:"NA07", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA08", name:"NA08", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA09", name:"NA09", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA10", name:"NA10", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
    ],
    "LU7_ROW13_ROCE_T2_RAIL3": [
      { id:"NB07", name:"NB07", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB08", name:"NB08", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB09", name:"NB09", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB10", name:"NB10", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
    ],
    "LU8_ROW12_SIS_T1": [
      { id:"NA06", name:"NA06", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
    ],
    "LU8_ROW12_SIS_NM": [
    { id:"NA05", name:"NA05", type:"SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) },
    ],
    "LU8_ROW13_SIS_T1": [
      { id:"NB06", name:"NB06", type:"SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) },
    ],
    "LU8_ROW13_SIS_NM": [
    { id:"NB05", name:"NB05", type:"SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) },
    ],
    "LU9_ROW12_ROCE_T2_RAIL4": [
      { id:"NA01", name:"NA01", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA02", name:"NA02", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA03", name:"NA03", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NA04", name:"NA04", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
    ],
    "LU9_ROW13_ROCE_T2_RAIL4": [
      { id:"NB01", name:"NB01", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB02", name:"NB02", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB03", name:"NB03", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
      { id:"NB04", name:"NB04", type:"ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) },
    ],
  };

  function cellKeyHash(s){
    let h = 2166136261;
    for (let i=0;i<s.length;i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h>>>0).toString(36);
  }

  const CELL_RACKS_UNIQUE = (()=>{
    const out = {};
    for (const [cellKey, racks] of Object.entries(CELL_RACKS||{})){
      const suf = cellKeyHash(String(cellKey));
      out[cellKey] = (racks||[]).map(r=>{
        const baseId = String(r.id||"");
        const uniqId = (/^(NA|NB)\d+/i.test(baseId)) ? (baseId + "@" + suf) : baseId;
        const aliases = Array.isArray(r.aliases) ? r.aliases.slice() : [];
        if (baseId && !aliases.includes(baseId)) aliases.push(baseId);
        if (r.name && !aliases.includes(r.name)) aliases.push(r.name);
        return { ...r, id: uniqId, aliases };
      });
    }
    return out;
  })();
  
  // --- PT: map rack aliases (NA29) -> unique rack ids (NA29@hash) ---
const PT_RACK_ALIAS_TO_UNIQUE_IDS = (() => {
  const m = new Map(); // aliasUpper -> Set(uniqueId)
  try {
    for (const racks of Object.values(CELL_RACKS_UNIQUE || {})) {
      for (const r of (racks || [])) {
        const uid = String(r.id || "").trim();
        const aliases = Array.isArray(r.aliases) ? r.aliases : [];
        for (const a of aliases) {
          const k = String(a || "").trim().toUpperCase();
          if (!k) continue;
          if (!m.has(k)) m.set(k, new Set());
          m.get(k).add(uid);
        }
      }
    }
  } catch {}
  return m;
})();

  const PROGRESS = {
  };

  function norm(s){
    return (s||"").toString()
      .replace(/\u00A0/g," ")
      .replace(/[‐‑‒–—−]/g,"-")
      .replace(/\s*-\s*/g,"-")
      .replace(/\s+/g," ")
      .trim()
      .toUpperCase();
  }
  function opt(v,t){ const o=document.createElement("option"); o.value=v; o.textContent=t; return o; }
  function resolveProcessKey(v){
    if (!v) return "ALL";
    if (v === "ALL") return "ALL";
    const q = norm(v);
    for (const k of ALL_PROCESSES) if (norm(k) === q) return k;
    return v;
  }

  // Normalize SU key to numeric string (e.g., "SU 96" -> "96")
  function suNumFromKey(v){
    const s = String(v == null ? "" : v).trim();
    const m = s.match(/(\d+)/);
    return m ? m[1] : "";
  }


  function getSuKeyFromEl(el){
    const ds = el.dataset && el.dataset.su;
    if (ds) return ds;
    const t=(el.textContent||"").trim();
    const m=t.match(/SU\s*([0-9]+)/i);
    return m ? m[1] : t;
  }

  function racksForSU(suKey){
    if (/^\d+$/.test(suKey)) {
      const base = SU_RACKS[suKey] || [];
      const extra = (typeof SU_GPU_RACKS !== "undefined" && SU_GPU_RACKS && SU_GPU_RACKS[suKey]) ? SU_GPU_RACKS[suKey] : [];

      const master = base.find(r => norm(r.type) === "ROCE T1");
      const others = base.filter(r => r !== master);
      const merged = [];
      if (master) merged.push(master);
      merged.push(...extra);
      merged.push(...others.filter(r => !extra.some(x => x.id === r.id)));
      return merged;
    }
    return CELL_RACKS[suKey] || [];
  }

  function buildGpuRacksFromSuEls(suEls){
    const out = {};
    const bySu = {};
    suEls.forEach(el=>{
      const suKey = getSuKeyFromEl(el);
      if (!/^\d+$/.test(suKey)) return;
      const code = (el.textContent||"").trim();
      if (!code) return;
      (bySu[suKey] ||= new Set()).add(code);
    });

    for (const [suKey, set] of Object.entries(bySu)){
      const master = (SU_RACKS[suKey]||[]).find(r => norm(r.type) === "ROCE T1");
      const masterName = master ? norm(master.name) : null;

      out[suKey] = Array.from(set)
        .filter(code => !masterName || norm(code) !== masterName)
        .map(code => ({
          id: `${code}-SU${suKey}`,
          name: code,
          type: "GPU",
          processes: (PROCESS_BY_TYPE["GPU"] || [])
        }))
        .sort((a,b)=>a.name.localeCompare(b.name));
    }
    return out;
  }

  function rackForElement(el){
    const suKey = getSuKeyFromEl(el);
    const proc = resolveProcessKey((document.getElementById("ptProcess")||{}).value);
    const code = (el.textContent||"").trim();
    const racks = racksForSU(suKey);

    if (/^\d+$/.test(suKey) && code) {
      const hit = racks.find(r => norm(r.name) === norm(code));
      if (hit) return hit;
      return { id: `${code}-SU${suKey}`, name: code, type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) };
    }

    if (code) {
      const hit = racks.find(r => norm(r.name) === norm(code) || norm(r.id) === norm(code) || (r.aliases||[]).some(a=>norm(a)===norm(code)));
      if (hit) return hit;
    }

    if (proc !== "ALL") {
      const elig = racks.find(r => canEditRackForProcess(r, proc));
      if (elig) return elig;
    }
    return racks[0] || null;
  }

  function computeRackStatusForProcess(suKey, rack, proc){
    if (!rack) return null;
    if (proc === "ALL") {
      let max = 1;
      let blocked = false;
      for (const p of (rack.processes||[])){
        const pk = resolveProcessKey(p);
        const tpl = PROCESS_TEMPLATES[pk];
        if (!tpl) continue;
        const c = getCode(suKey, rack.id, pk);
        if (tpl[c] === "BLOCKED") blocked = true;
        if (c > max) max = c;
      }
      return blocked ? 7 : max;
    }
    if (!canEditRackForProcess(rack, proc)) return null;
    return getCode(suKey, rack.id, proc);
  }

  function findRackById(rackId){
    if (!rackId) return null;
    for (const arr of Object.values(SU_RACKS)){
      const r = (arr||[]).find(x=>x.id===rackId);
      if (r) return r;
    }
    for (const arr of Object.values(CELL_RACKS)){
      const r = (arr||[]).find(x=>x.id===rackId);
      if (r) return r;
    }
    return null;
  }

  function hasProcess(rack, proc){ return (rack.processes||[]).some(p=>norm(p)===norm(proc)); }

  function rackTypeForProcess(proc){
    proc = resolveProcessKey(proc);
    if (proc === "ALL") return null;
    for (const [t, arr] of Object.entries(PROCESS_BY_TYPE)){
      if ((arr||[]).some(p=>norm(p)===norm(proc))) return t;
    }
    return null;
  }

  function rackMatchesProcessType(rack, proc){
    const t = rackTypeForProcess(proc);
    if (!t) return true;
    return norm(rack.type) == norm(t);
  }

  function canEditRackForProcess(rack, proc){
    return !!rack && proc !== "ALL" && hasProcess(rack, proc) && rackMatchesProcessType(rack, proc);
  }
  function hasProcessInSU(suKey, proc){
    const racks = racksForSU(suKey);
    return racks.some(r => canEditRackForProcess(r, proc));
  }

  function statusKey(suKey, rackId, proc){
    proc = resolveProcessKey(proc);
    if (!rackId || proc === "ALL") return null;
    return `${rackId}|${proc}`;
  }

  function getCode(suKey, rackId, proc){
    proc = resolveProcessKey(proc);
    const k = statusKey(suKey, rackId, proc);
    if (!k) return 1;

    if (PROGRESS[k] != null) return PROGRESS[k];

    if (suKey != null && suKey !== "") {
      const legacy1 = String(suKey) + "::" + String(rackId) + "|" + String(proc);
      if (PROGRESS[legacy1] != null) return PROGRESS[legacy1];
    }

    const base = String(rackId).split('@')[0];
    if (base && base !== rackId) {
      const k2 = base + "|" + String(proc);
      if (PROGRESS[k2] != null) return PROGRESS[k2];
      if (suKey != null && suKey !== "") {
        const legacy2 = String(suKey) + "::" + base + "|" + String(proc);
        if (PROGRESS[legacy2] != null) return PROGRESS[legacy2];
      }
    }

    return 1;
  }

  function findRackInSU(suKey, rackId){
    if (!suKey || !rackId) return null;
    const racks = racksForSU(suKey);
    return (racks||[]).find(r => r.id === rackId) || null;
  }

  function setCode(suKey, rackId, proc, code){
    proc = resolveProcessKey(proc);
    const k = statusKey(suKey, rackId, proc);
    if (!k) return;

    const rackObj = findRackInSU(suKey, rackId);
    if (rackObj && !canEditRackForProcess(rackObj, proc)) return;
    PROGRESS[k] = Number(code);
  }

  function setCodeFromBackend(suKey, rackId, proc, code){
      proc = resolveProcessKey(proc);
      const k = statusKey(suKey, rackId, proc);
      if (!k) return;
      PROGRESS[k] = Number(code);
    }
  
  

  const PT_DB = { statusKeyToId: new Map(), procDescToId: new Map(), runIndex: new Map(), loaded: false };
    window.PT_DB = PT_DB;

  function ptNoteKey(suKey, rackId, procKey) {
  return `pt_note|${String(suKey)}|${String(rackId)}|${String(procKey)}`;
}

function setStoredNote(suKey, rackId, procKey, text) {
  try {
    const v = String(text || "").trim();
    localStorage.setItem(ptNoteKey(suKey, rackId, procKey), v);
  } catch {}
}

function getStoredNote(suKey, rackId, procKey) {
  try {
    return localStorage.getItem(ptNoteKey(suKey, rackId, procKey)) || "";
  } catch {
    return "";
  }
}

// чтобы можно было проверять из консоли
window.setStoredNote = setStoredNote;
window.getStoredNote = getStoredNote;


  function ptDeepGet(obj, key){
    if (!obj || typeof obj !== "object") return undefined;
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
    // Common nesting
    const nests = ["rack","rack_info","rackInfo","run","process","status","current_status","currentStatus"];
    for (const n of nests){
      if (obj[n] && typeof obj[n]==="object" && Object.prototype.hasOwnProperty.call(obj[n], key)) return obj[n][key];
    }
    return undefined;
  }
  function ptPick(row, keys){
    for (const k of keys){
      const v = (row && row[k] != null) ? row[k] : ptDeepGet(row, k);
      if (v != null && String(v).trim() !== "") return v;
    }
    return null;
  }

  function ptRackIdFromRow(row, suKey){
    const rackIdRaw = ptPick(row, ["rack_id","rackId","rack"]);
    const rackName = ptPick(row, ["rack_name","rackName"]);
    let rackId = rackIdRaw != null ? String(rackIdRaw).trim() : (rackName != null ? String(rackName).trim() : "");
    if (!rackId) return "";

    // Normalize
    rackId = rackId.toUpperCase();

    const suNum = suNumFromKey(suKey) || String(suKey || "").trim();
    const lu = String(ptPick(row, ["lu","LU","lu_key","luKey"]) || "").trim().toUpperCase();
    const rackRow = String(ptPick(row, ["rack_row","row","rackRow"]) || "").trim();

    // If backend already sends a UI-like id that includes SU, keep it.
    // Accept common separators: "-SU", "_SU", " SU"
    if (/\bSU\s*\d+\b/i.test(rackId) || /[-_]\s*SU\s*\d+/i.test(rackId)) return rackId.replace(/\s+/g, "");

    // --- PT_FIX_V20: robust DOM mapping using SU + LU + row + rack_name/type ---
    // Many UIs do NOT use "GPU-SU2" style ids. They may use slot ids like "LAC-SU2"
    // or values containing LU/Row. When backend sends rack_name="GPU" (type), we must
    // find the *actual* UI rackId option for that SU/LU/row.
    try {
      const suDigits = String(suNum).replace(/^SU\s*/i,"").trim();
      const wantName = norm(rackName || rackId);
      const wantType = norm(String(ptPick(row, ["rack_type","rackType","type"]) || rackName || rackId));
      const opts = Array.from(document.querySelectorAll("select option"));
      const suRe = suDigits ? new RegExp("(?:^|[^0-9])" + suDigits + "(?:$|[^0-9])") : null;
      const rowRe = rackRow ? new RegExp("(?:ROW\\s*0*" + rackRow + "|\\bR\\s*0*" + rackRow + "\\b|\\b0*" + rackRow + "\\b)", "i") : null;

      let best = { score: -1, value: "" };

      const txt = (o)=>String((o && (o.value || o.textContent)) || "").trim();
      for (const o of opts){
        const raw = txt(o);
        if (!raw) continue;
        const v = raw.toUpperCase();
        let score = 0;

        // SU match (strong requirement when available)
        if (suDigits) {
          if (v.includes("SU"+suDigits) || v.includes("SU "+suDigits) || v.includes("-SU"+suDigits) || v.includes("_SU"+suDigits) || (suRe && suRe.test(v))) score += 6;
          else continue; // if we know SU, don't consider other SUs
        }

        // LU match (very strong)
        if (lu) {
          if (v.includes(lu)) score += 6;
        }

        // Row match (strong)
        if (rowRe) {
          if (rowRe.test(v)) score += 4;
        }

        // Type/name hints (weak)
        const nv = norm(v);
        if (wantType && (nv.includes(wantType) || wantType.includes(nv))) score += 1;
        if (wantName && (nv.includes(wantName) || wantName.includes(nv))) score += 1;

        // Prefer option VALUE over just label if both exist
        if (o && o.value) score += 0.5;

        if (score > best.score) best = { score, value: String(o.value || o.textContent || "").trim() };
      }

      // Require at least SU + one discriminator (LU or row) when provided
      const minScore = (suDigits ? 6 : 0) + ((lu ? 1 : 0) + (rowRe ? 1 : 0) ? 4 : 0);
      if (best.value && best.score >= Math.max(6, minScore)) {
        return best.value.toUpperCase().replace(/\s+/g,"");
      }
    } catch (e) {}

    // Older DOM mapping: try to find a value that contains short name and SU
    const shortName = rackId;
    if (suNum) {
      try {
        const suDigits = String(suNum).replace(/^SU\s*/i, "").trim();
        const suRe = new RegExp("(?:^|[^0-9])" + String(suDigits) + "(?:$|[^0-9])");
        const nameRe = new RegExp("^" + shortName + "(?:\\b|[^A-Z0-9])", "i");
        const opts = Array.from(document.querySelectorAll("select option"));
        const pick = (opt) => String(opt.value || opt.textContent || "").trim();
        let best = "";
        for (const opt of opts) {
          const v = pick(opt).toUpperCase();
          if (!v) continue;
          if (!v.includes(shortName)) continue;
          if (!(v.includes("SU"+suDigits) || v.includes("SU "+suDigits) || v.includes("-SU"+suDigits) || v.includes("_SU"+suDigits) || suRe.test(v))) continue;
          if (!best || nameRe.test(v)) { best = v; if (nameRe.test(v)) break; }
        }
        if (best) return best.replace(/\s+/g, "");
      } catch (e) {}
    }

    // Fallback: if backend sends only the short rack code, synthesize UI id.
    if (suNum && /^[A-Z0-9]{3,6}$/i.test(shortName)) {
      return shortName + "-SU" + String(suNum).replace(/^SU\s*/i,"").trim();
    }

    return rackId;
  }




// PT_FIX_V18_DOM_RACK_MAP: If SU_RACKS/SU_GPU_RACKS don't include this SU (e.g., SU=96),
// derive rack ids from the DOM so backend generic racks like "GPU" map to UI slots like "LSL-SU96".
function ptDomRackIdsForSUAndType(suNum, wantType, wantName){
  // PT_FIX_V19_DOM_RACK_FALLBACK:
  // Some SU dropdown options are slot-only labels like "LSL" with values "LSL-SU96" (no "GPU" substring).
  // Backend rows may contain rack_name/rack_type like "GPU". When strict matching finds nothing,
  // fall back to returning *all* rack ids for the SU from the DOM, so we can still paint the UI.
  try {
    const suf = "-SU" + String(suNum);
    const all = [];
    const filtered = [];
    const seenAll = new Set();
    const seenFiltered = new Set();
    const opts = document.querySelectorAll("option");
    for (const o of opts){
      const v = (o.value || "").trim();
      if (!v || !v.endsWith(suf)) continue;
      const t = (o.textContent || "").trim();
      if (!seenAll.has(v)) {
        seenAll.add(v);
        all.push(v);
      }
      const nv = norm(v);
      const nt = norm(t);
      let ok = true;
      if (wantType) ok = ok && (nv.includes(wantType) || nt.includes(wantType));
      if (ok && wantName) ok = ok && (nv.includes(wantName) || nt.includes(wantName));
      if (!ok) continue;
      if (seenFiltered.has(v)) continue;
      seenFiltered.add(v);
      filtered.push(v);
    }
    // If strict filter found nothing, return all SU rack ids from DOM
    return filtered.length ? filtered : ( (!wantType && !wantName) ? all : [] );
  } catch {
    return [];
  }
}
// PT_FIX_V13_BOOTSTRAP_AND_REFRESH: Map backend rows (which use generic rack_name/rack_type like "GPU")
// onto UI rack ids (like "LSL-SU96") so the map colors reflect DB state after refresh.
function ptCandidateRackIdsForRow(suKey, row, baseRackId) {
  const suNum = suNumFromKey(suKey) || String(suKey || "").trim();
  const racks = racksForSU(suNum) || [];
  const rackType = String(ptPick(row, ["rack_type","rackType","type"]) || "").trim();
  const rackName = String(ptPick(row, ["rack_name","rackName","rack"]) || "").trim();

  const wantType = norm(rackType || rackName);
  const wantName = norm(rackName);

  let hits = [];
  // If our static rack lists don't include this SU (common for higher SU numbers),
  // fall back to DOM-derived rack ids so we can map generic backend racks (e.g., "GPU")
  // onto UI slot ids (e.g., "LSL-SU96").
  const domRackIds = (!racks.length && (wantType || wantName))
    ? ptDomRackIdsForSUAndType(suNum, wantType, wantName)
    : [];
  if (!hits.length && domRackIds.length) {
    hits = domRackIds.map(id => ({ id }));
  }
  if (wantType) {
    hits = racks.filter(r => norm(r.type) === wantType);
  }
  // fallback: match by rack "name" (some lists use name as the label)
  if (!hits.length && wantName) {
    hits = racks.filter(r => norm(r.name) === wantName);
  }
  // If we still have no hits, but DOM gave us candidates, use them
  if (!hits.length && domRackIds.length) {
    hits = domRackIds.map(id => ({ id }));
  }

  
  // PT_FIX_V19: If DOM provided rack ids for this SU, union them in as candidates.
  // This makes mapping work even when static racks list is incomplete (e.g., SU96) or filtered by type yields only GPU-SUxx.
  if (domRackIds.length) {
    for (const id of domRackIds) hits.push({ id });
  }

// Always include baseRackId if it is a real UI rack id present in this SU
  if (baseRackId) {
    const exists = racks.some(r => norm(r.id) === norm(baseRackId));
    if (exists) hits.push(racks.find(r => norm(r.id) === norm(baseRackId)));
  }
  // Deduplicate and return ids
  const out = [];
  const seen = new Set();
  for (const r of (hits || [])) {
    if (!r || !r.id) continue;
    const k = String(r.id);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  // As a last resort, if we still have nothing, fall back to baseRackId directly
  if (!out.length && baseRackId) out.push(baseRackId);
  return out;
}
function suKeyToUI(x) {
  const s = String(x || "").trim();
  const m = s.match(/(\d+)/);
  return m ? ("SU" + m[1]) : s;
}

function ptApplyBackendRowToUI(row) {
  console.log("[PT] ptApplyBackendRowToUI called", row && row.rack_process_run_id);

  const runId = Number(ptPick(row, ["rack_process_run_id","run_id","id"]) || 0);
  if (!runId) return;

  const suKeyRaw = String(ptPick(row, ["su_key","su","suKey","su_id","su_number"]) || "").trim();

  // 1) "79" — для rack mapping / backend
const suNumOnly = (() => {
  const raw = String(suNumFromKey(suKeyRaw) || "").trim();
  // только цифры считаем SU номером
  return /^\d+$/.test(raw) ? raw : "";
})();

// 2) "SU79" — для UI storage keys
const suKeyInternal = suNumOnly; // "" для NA/NB
const suKeyUI = suNumOnly ? suKeyToUI(suNumOnly) : "";

// будем писать/индексировать под обоими ключами
let suKeysToWrite = Array.from(new Set([suKeyInternal, suKeyUI].filter(Boolean)));

// suKeyEff оставляем ТОЛЬКО как "fallback key" для non-SU строк (NA/NB),
// иначе по умолчанию используем внутренний "79"
let suKeyEff = suKeyInternal;
if (!suKeyEff) {
  const luEff = String(ptPick(row, ["lu","LU","lu_key","luKey"]) || "").trim();
  const rowEff = String(ptPick(row, ["rack_row","row","rackRow"]) || "").trim();
  const typeEff = String(ptPick(row, ["rack_type","rackType","type"]) || "").trim();
  if (luEff && rowEff && typeEff) {
    suKeyEff = `${luEff}_ROW${rowEff}_${typeEff.replace(/\s+/g, "_").toUpperCase()}`;
  }
}


  const procKey = String(ptPick(row, ["process_name","process","processName","rack_type","rackType","type"]) || "").trim();
  if (!procKey) return;
  const statusName = ptPick(row, ["status_name","status","statusName","current_status_name"]);


  // ✅ ВАЖНО: для rack mapping используем suNumOnly, а не "SU79"
  const baseRackId = ptRackIdFromRow(row, suNumOnly);
  const rackIds = ptCandidateRackIdsForRow(suNumOnly, row, baseRackId);

  // 🔧 ДОБАВКА: принудительно добавляем rack_name из backend
const rackName = String(ptPick(row, ["rack_name", "rackName", "rack"]) || "").trim();

if (rackName) {
  rackIds.push(rackName);
  if (suNumOnly) rackIds.push(`${rackName}-SU${suNumOnly}`);
}


// ✅ PT 3.2: для NA/NB (когда нет нормального su_key) пишем под CELL key (LUx_ROWy_...)
// чтобы UI, который выбирает по "LU1_ROW12_SIS_T1", смог прочитать status/note
try {
  // если suNumOnly пустой ИЛИ вообще нет цифр SU — это не SU-строка
  const isSuRow = !!suNumOnly;

  if (!isSuRow && rackName) {
    const base = String(rackName).trim().toUpperCase();
    const cellKeys = (typeof PT_RACK_TO_CELL_KEYS !== "undefined")
      ? PT_RACK_TO_CELL_KEYS.get(base)
      : null;

    if (cellKeys && cellKeys.size) {
      for (const ck of cellKeys) suKeysToWrite.push(ck);
      suKeysToWrite = Array.from(new Set(suKeysToWrite.filter(Boolean)));
    }
  }
} catch {}
console.log("[SUKEYS]", rackName, suNumOnly, suKeysToWrite);

// убираем дубликаты
const uniqueRackIds = Array.from(new Set(rackIds));

// ✅ Expand NA/NB base ids (NA29) -> actual unique ids (NA29@hash) used by UI
const expandedRackIdsSet = new Set(uniqueRackIds);
for (const rid of uniqueRackIds) {
  const key = String(rid || "").trim().toUpperCase();
  const uids = PT_RACK_ALIAS_TO_UNIQUE_IDS.get(key);
  if (uids) for (const u of uids) expandedRackIdsSet.add(u);
}
const expandedRackIds = Array.from(expandedRackIdsSet);

// лог лучше показывать expanded
console.log("[RACKIDS]", suNumOnly, "=>", suKeyEff, { uniqueRackIds, expandedRackIds });

const procId = PT_DB.procDescToId.get(norm(procKey)) || Number(ptPick(row, ["process_id","processId"])) || null;

// ✅ 1) runIndex — используем expandedRackIds
for (const rid of expandedRackIds) {
  // ключи с SU (и "79", и "SU79")
  for (const suK of suKeysToWrite) {
    PT_DB.runIndex.set(`${suK}|${rid}|${procKey}`, { runId, processId: procId });
    PT_DB.runIndex.set(`${norm(suK)}|${norm(rid)}|${norm(procKey)}`, { runId, processId: procId });
  }

  // ключи без SU (fallback для мест где UI ищет только rack|proc)
  PT_DB.runIndex.set(`${rid}|${procKey}`, { runId, processId: procId });
  PT_DB.runIndex.set(`${norm(rid)}|${norm(procKey)}`, { runId, processId: procId });
}

if (runId === 469) {
  console.log("[RUN469 APPLY]", { suKeyRaw, suNumOnly, suKeyEff, procKey, statusName, uniqueRackIds, expandedRackIds });
}

// ✅ 2) status apply — используем expandedRackIds
if (statusName != null) {
  const code = ptFindCodeByLabel(procKey, statusName);
  if (code != null) {
    for (const rid of expandedRackIds) {
      for (const suK of suKeysToWrite) {
        setCodeFromBackend(suK, rid, procKey, code);
      }
    }
  }
}

const noteText = String(ptPick(row, ["note","notes","comment"]) || "").trim();

const noteFn =
  (typeof window.setStoredNote === "function" ? window.setStoredNote : null) ||
  (typeof setStoredNote === "function" ? setStoredNote : null);

// ✅ 3) note apply — используем expandedRackIds
if (noteText && noteFn) {
  for (const rid of expandedRackIds) {
    for (const suK of suKeysToWrite) {
      noteFn(suK, rid, procKey, noteText);
    }
  }
}


}


  function ptFindCodeByLabel(procKey, statusLabel){
    const tpl = PROCESS_TEMPLATES[procKey];
    if (!tpl) return null;

    const target = norm(statusLabel);
    const entries = Object.entries(tpl).map(([k,v]) => [Number(k), String(v)]);
    // 1) exact label match
    for (const [k, v] of entries){
      if (norm(v) === target) return k;
    }

    // 2) fuzzy matches for common backend labels that may not exist in the UI template
    const has = (s) => target.includes(norm(s));

    // QC DONE / QC ONLY statuses -> prefer any template status that contains "QC"
    if (has("QC")) {
      const qc = entries
        .filter(([k,v]) => norm(v).includes("QC"))
        .sort((a,b)=>a[0]-b[0]);
      if (qc.length) return qc[qc.length-1][0];

      // fallback: treat QC DONE as some kind of DONE
      const done = entries
        .filter(([k,v]) => norm(v).includes("DONE") && !norm(v).includes("BLOCK"))
        .sort((a,b)=>a[0]-b[0]);
      if (done.length) return done[done.length-1][0];
    }

    // DONE-like statuses -> map to the highest DONE code (excluding BLOCKED)
    if (has("DONE")) {
      const done = entries
        .filter(([k,v]) => norm(v).includes("DONE") && !norm(v).includes("BLOCK"))
        .sort((a,b)=>a[0]-b[0]);
      if (done.length) return done[done.length-1][0];
    }

    // IN PROGRESS-like statuses -> map to first IN PROGRESS code
    if (has("PROGRESS")) {
      const prog = entries
        .filter(([k,v]) => norm(v).includes("PROGRESS"))
        .sort((a,b)=>a[0]-b[0]);
      if (prog.length) return prog[0][0];
    }

    return null;
  }

  function ptCodeToStatusId(procKey, code, processId){
    const tpl = PROCESS_TEMPLATES[procKey];
    if (!tpl) return null;
    const label = tpl[Number(code)];
    if (!label) return null;
    const pid = Number(processId);
    if (!pid) return null;
    const id = PT_DB.statusKeyToId.get(pid + "|" + norm(label));
    return (id != null) ? Number(id) : null;
  }

  async function ptBootstrapFromBackend(){
    if (!window.PT_REST) return;
    try {
      const processes = await window.PT_REST.apiGetProcesses();
      PT_DB.procDescToId = new Map((processes || []).map(p => [norm(p.description), Number(p.id)]));
      const pairs = [];
      for (const p of (processes || [])){
        const pid = Number(p.id);
        if (!pid) continue;
        const sts = await window.PT_REST.apiGetProcessStatuses(pid);
        for (const s of (sts || [])){
          pairs.push([pid + "|" + norm(s.name), Number(s.id)]);
        }
      }
      PT_DB.statusKeyToId = new Map(pairs);
    } catch {}
    try {
      // Prefer the /api/runs endpoint as source of truth: it includes all runs and is ordered.
      // The view endpoint may be limited and miss the row we need.
      const rows = await window.PT_REST.fetchJSON("/api/runs?limit=20000&_=" + Date.now());
console.log("[BOOT] /api/runs isArray=", Array.isArray(rows), "len=", rows && rows.length, "sample=", Array.isArray(rows) ? rows[0] : rows);

const normRows =
  Array.isArray(rows) ? rows :
  (rows && typeof rows === "object" && Array.isArray(rows.rows)) ? rows.rows :
  (rows && typeof rows === "object" && Array.isArray(rows.data)) ? rows.data :
  (rows && typeof rows === "object" && Array.isArray(rows.result)) ? rows.result :
  (rows && typeof rows === "object" && Array.isArray(rows.items)) ? rows.items :
  [];

console.log("[BOOT] normalized len=", normRows && normRows.length, "sample=", normRows && normRows[0]);

for (const row of normRows) {
  try {
    ptApplyBackendRowToUI(row);
  } catch (e) {
    console.warn("[BOOTSTRAP APPLY ERROR]", e, row);
  }
}

console.log("[BOOT] after apply runIndex.size=", window.PT_DB && window.PT_DB.runIndex && window.PT_DB.runIndex.size);


      PT_DB.loaded = true;
    } catch (e) {
        console.warn("[BOOT] bootstrap failed:", e);

      // fallback to the view (may be limited)
      try {
  const rows2 = await window.PT_REST.apiGetRackProcessStatus();

  const normRows2 =
    Array.isArray(rows2) ? rows2 :
    (rows2 && typeof rows2 === "object" && Array.isArray(rows2.rows)) ? rows2.rows :
    (rows2 && typeof rows2 === "object" && Array.isArray(rows2.data)) ? rows2.data :
    (rows2 && typeof rows2 === "object" && Array.isArray(rows2.result)) ? rows2.result :
    (rows2 && typeof rows2 === "object" && Array.isArray(rows2.items)) ? rows2.items :
    [];

  console.log("[BOOT] view normalized len=", normRows2.length, "sample=", normRows2[0]);

  for (const row of normRows2) {
    try {
      ptApplyBackendRowToUI(row);
    } catch (e2) {
      console.warn("[BOOTSTRAP APPLY ERROR view]", e2, row);
    }
  }

  console.log("[BOOT] after view apply runIndex.size=", window.PT_DB?.runIndex?.size);
  PT_DB.loaded = true;
} catch (e2) {
  console.warn("[BOOT] view fallback failed:", e2);
}

    }
  }

  function ptRackNameForDB(rackStr) {
  let s = String(rackStr || "").trim();

  // если в UI "LPC • ROCE T1" — берём только левую часть
  s = s.split("•")[0].trim();

  // убираем суффиксы SU:  "LPC-SU79" / "LPC_SU79" / "LPC SU79"
  s = s.replace(/[-_\s]*SU\s*\d+$/i, "");

  // иногда прилетает "@..." — тоже выкидываем
  s = s.split("@")[0].trim();

  return s;
}

  function ptRackNameForBackend(rackId) {
  // "LPC-SU79" -> "LPC"
  // "LPC • ROCE T1" -> "LPC"
  // "NB 27" -> "NB27" (если вдруг такое прилетит)
  let s = String(rackId || "").trim();

  // отрезаем "@..."
  s = s.split("@")[0].trim();

  // отрезаем " • TYPE"
  s = s.replace(/\s*•\s*.*$/, "").trim();

  // убираем суффикс "-SU79" / "SU79"
  s = s.replace(/-?\s*SU\s*\d+$/i, "").trim();

  // убираем пробелы внутри
  s = s.replace(/\s+/g, "");

  return s;
}


  async function ptPersistToBackend(suKey, rackId, procKey, code, noteText){
    if (!window.PT_REST) throw new Error("API is not available");

    const suStrRaw = String(suKey || "").trim();

// ✅ FIX: если это CELL KEY (LUx_ROWy_...), НЕ превращаем в SU-номер
const isCellKey = /^LU\d+_ROW\d+_/i.test(suStrRaw);

// suNumOnly нужен ТОЛЬКО для настоящих SU (79 / SU79)
const suNumOnly = isCellKey
  ? ""
  : (() => {
      const raw = String(suNumFromKey(suStrRaw) || "").trim();
      return /^\d+$/.test(raw) ? raw : "";
    })();

// suStr — ключ, под которым UI/индекс хранит (SU: "79", CELL: "LU1_ROW12_SIS_T1")
const suStr = isCellKey ? suStrRaw : (suNumOnly || suStrRaw);

const rackStr = String(rackId || "").trim();      // ✅ ОБЯЗАТЕЛЬНО ДО rackBase/rackNorm
const procStr = String(procKey || "").trim();

const rackBase = ptRackNameForBackend(rackStr);
const suNorm = norm(suStr);
const rackNorm = norm(rackStr);
const procNorm = norm(procStr);

console.log("[SU FIX]", { suStrRaw, isCellKey, suNumOnly, suStr, suNorm, rackStr, rackBase, procStr });


    // 1) Fast-path lookups (existing key formats)
    let runInfo =
      PT_DB.runIndex.get(`${suStr}|${rackStr}|${procStr}`) ||
      PT_DB.runIndex.get(`${rackStr}|${procStr}`) ||
      PT_DB.runIndex.get(`${suNorm}|${rackNorm}|${procNorm}`) ||
      PT_DB.runIndex.get(`${rackNorm}|${procNorm}`);

    // 2) Try alternate rack id formats for SU-based racks (GPU-SUXX etc.)
    console.log("[SAVE DEBUG] runInfo=", runInfo, "su=", suStr, "rackStr=", rackStr, "proc=", procStr);

    if (!runInfo) {
      const suNumFromSuKey = suStr.replace(/^SU\s*/i, "").trim();
      const suNumFromRackId = (rackStr.match(/SU\s*([0-9]+)/i) || [])[1] || "";
      const suNum = suNumFromRackId || suNumFromSuKey;
      if (suNum) {
        const altRackId = `GPU-SU${suNum}`;
        runInfo =
          PT_DB.runIndex.get(`${suNum}|${altRackId}|${procStr}`) ||
          PT_DB.runIndex.get(`${norm(suNum)}|${norm(altRackId)}|${procNorm}`) ||
          PT_DB.runIndex.get(`${altRackId}|${procStr}`) ||
          PT_DB.runIndex.get(`${norm(altRackId)}|${procNorm}`);
      }
    }

    // 3) Fallback: scan the index by SU + process (handles UI rack ids like "LSL-SU96")
    if (!runInfo) {
      const wantedSuffix1 = `|${procStr}`;
      const wantedSuffix2 = `|${procNorm}`;
      for (const [k, v] of PT_DB.runIndex.entries()) {
        // we store keys in multiple forms; accept either raw or normalized proc suffix
        if (!(k.endsWith(wantedSuffix1) || k.endsWith(wantedSuffix2))) continue;

        // prefer keys that include the SU prefix: "96|<rack>|GPU AEC"
        if (suStr && k.startsWith(`${suStr}|`)) { runInfo = v; break; }
        if (suNorm && k.startsWith(`${suNorm}|`)) { runInfo = v; break; }
      }
    }

    // 4) Guaranteed fallback: fetch latest runs from backend and match by su_key + process_name
    //    NOTE: PT_REST.apiGetRackProcessStatus() uses the VIEW endpoint and may not include everything we need for writes.
    //    For writes we use /api/runs which contains rack_process_run_id reliably.
    // 4) Preferred lookup: ask backend for the exact run (fast + deterministic)
if (!runInfo) {
  try {
    const url =
      "/api/runs/lookup" +
      "?su_key=" + encodeURIComponent(String(suNumOnly || "").trim()) +
      "&rack_name=" + encodeURIComponent(String(rackBase || "").trim()) +
      "&process_name=" + encodeURIComponent(String(procStr || "").trim());

    const found = await window.PT_REST.fetchJSON(url);
    const foundRunId = Number(found?.rack_process_run_id || found?.run_id || found?.id || 0);

    if (foundRunId) {
      runInfo = {
        runId: foundRunId,
        processId: Number(found?.process_id || 0),
        su_key: String(found?.su_key || suNumOnly || ""),
        rack_name: String(found?.rack_name || rackBase || ""),
        process_name: String(found?.process_name || procStr || "")
      };

      // Seed index so next save is instant
      try {
        PT_DB.runIndex.set(`${suStr}|${rackStr}|${procStr}`, runInfo);
        PT_DB.runIndex.set(`${suStr}|${rackBase}|${procStr}`, runInfo);
        PT_DB.runIndex.set(`${rackStr}|${procStr}`, runInfo);
        PT_DB.runIndex.set(`${rackBase}|${procStr}`, runInfo);
      } catch {}

      // Apply immediately (so UI reflects backend without refresh)
      try { ptApplyBackendRowToUI(found); } catch {}
    }
  } catch (e) {
    // ignore (404 not found пока нет строки — норм)
  }
}

    if (!runInfo) {
      try {
        const rows = await window.PT_REST.fetchJSON("/api/runs?limit=20000&_=" + Date.now());
        const suNum = suNumFromKey(suStrRaw) || suNumFromKey(suStr) || suStr.replace(/^SU\s*/i, "").trim();
        if (Array.isArray(rows) && suNum) {
          const match = rows.find(r =>
            String(r.su_key || "").trim() === String(suNum) &&
            norm(String(r.rack_name || "").trim()) === norm(String(rackBase || "").trim()) &&
            norm(String(r.process_name || "").trim()) === procNorm
          );
          if (match) {
            runInfo = {
              runId: Number(match.rack_process_run_id || match.run_id || match.id),
              processId: Number(match.process_id || 0),
              su_key: String(match.su_key || suNum),
              rack_name: String(match.rack_name || ""),
              process_name: String(match.process_name || procStr)
            };

            // Seed index with a few helpful keys so next save is fast
            try {
              PT_DB.runIndex.set(`${suNum}|${rackStr}|${procStr}`, runInfo);
              PT_DB.runIndex.set(`${suStr}|${rackStr}|${procStr}`, runInfo);
              PT_DB.runIndex.set(`${suStr}|${rackBase}|${procStr}`, runInfo);


              const baseRack = String(match.rack_name || "").trim();
              if (baseRack) {
                const altRack1 = `${baseRack}-SU${suNum}`;
                PT_DB.runIndex.set(`${altRack1}|${procStr}`, runInfo);
                PT_DB.runIndex.set(`${suNum}|${altRack1}|${procStr}`, runInfo);
              }
            } catch {}
          }
        }
      } catch {}
    }

    if (!runInfo) {
      // Upsert mode: let backend create missing rack + run rows (requires runs.upsert.js deployed)
      const processIdGuess = (PT_DB.procDescToId.get(procNorm) || 0);
      const status_id_tmp = ptCodeToStatusId(procStr, code, processIdGuess);
      if (!status_id_tmp) throw new Error("Cannot map status to DB id");

      const upsertPayload = {
        su_key: Number(suNumOnly),
        rack_name: String(rackBase),
        process_id: processIdGuess || undefined,
        process_name: processIdGuess ? undefined : procStr,
        status_id: status_id_tmp,
        note: (noteText ? String(noteText).trim() : null),
      };

      const respUpsert = await window.PT_REST.fetchJSON("/api/runs/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upsertPayload),
      });

      const updatedUpsert = (respUpsert && respUpsert.updated) ? respUpsert.updated : null;
      if (updatedUpsert) {
        ptApplyBackendRowToUI(updatedUpsert);
        PT_DB.loaded = true;
        return respUpsert;
      }

      throw new Error("Upsert failed: backend did not return updated row");
    }

const runId = (typeof runInfo === "object" && runInfo) ? Number(runInfo.runId) : Number(runInfo);const processId = (typeof runInfo === "object" && runInfo) ? Number(runInfo.processId)
      : (PT_DB.procDescToId.get(procNorm) || 0);

    if (!runId) {
      throw new Error(`PT_FIX_RUNLOOKUP_V10: No rack_process_run_id for selected SU/rack/process: su=${suStr}, rack=${rackStr}, process=${procStr}`);
    }

    const status_id = ptCodeToStatusId(procStr, code, processId);
    if (!status_id) throw new Error("Cannot map status to DB id");

    const resp = await window.PT_REST.apiUpdateRunStatus(runId, {
      status_id,
      note: (noteText ? String(noteText).trim() : null)
    });

    // ✅ FAST PATH: backend already returns the source of truth
if (resp && resp.updated) {
  try {
    // 1) применяем "истину" от backend сразу в UI/индекс
    ptApplyBackendRowToUI(resp.updated);
    PT_DB.loaded = true;

    // 2) 🔒 фиксируем runId в runIndex, чтобы следующий клик НЕ искал его снова
    const updated = resp.updated;
    const locked = {
      runId: Number(updated.rack_process_run_id),
      processId: Number(updated.process_id || processId),
      su_key: String(updated.su_key || suStr),
      rack_name: String(updated.rack_name || rackStr),
      process_name: String(updated.process_name || procStr),
    };

    // ключи, которые ты используешь в начале ptPersistToBackend (1377-1381)
    PT_DB.runIndex.set(`${suStr}|${rackStr}|${procStr}`, locked);
    PT_DB.runIndex.set(`${rackStr}|${procStr}`, locked);
    PT_DB.runIndex.set(`${suNorm}|${rackNorm}|${procNorm}`, locked);
    PT_DB.runIndex.set(`${rackNorm}|${procNorm}`, locked);
  } catch (e) {}

  // ❗всё: без дополнительных GET /api/runs
  return resp;
}

// ✅ если updated нет — оставляем как было (fallback)
return resp;


    // If backend returns the updated row, apply it to UI state so refresh isn't required.
    try {
      const updated = (resp && resp.updated) ? resp.updated : null;
      if (updated) {
        ptApplyBackendRowToUI(updated);
        PT_DB.loaded = true;
      }
    } catch {}

    return resp;
  }


  function hasBlockedBySU(suKey, proc){
    const racks = racksForSU(suKey);
    if (!racks.length) return false;

    if (proc === "ALL") {
      for (const r of racks){
        for (const p of (r.processes||[])){
          const pk = resolveProcessKey(p);
          const tpl = PROCESS_TEMPLATES[pk];
          if (!tpl) continue;
          const c = getCode(suKey, r.id, pk);
          if (tpl[c] === "BLOCKED") return true;
        }
      }
      return false;
    }

    for (const r of racks){
      if (!canEditRackForProcess(r, proc)) continue;
      const tpl = PROCESS_TEMPLATES[proc];
      if (!tpl) continue;
      const c = getCode(suKey, r.id, proc);
      if (tpl[c] === "BLOCKED") return true;
    }
    return false;
  }

  function injectStyles(){
    const css = `
      .pt-select{width:100%;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.18);color:#fff;padding:0 10px;font-weight:800}
      .pt-hint{margin-top:8px;color:rgba(255,255,255,.55);font-size:12px;font-weight:800}
      .pt-btn{height:34px;padding:0 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.18);color:#fff;font-weight:900;cursor:pointer}
      .pt-btn:hover{filter:brightness(1.06)}
      .su{cursor:pointer;transition:opacity .15s ease,filter .15s ease,outline .15s ease}
      .su.pt-selected{outline:2px solid rgba(111,140,255,.60);box-shadow:0 0 0 6px rgba(111,140,255,.10);opacity:1 !important;filter:none !important}
      .su.pt-dim{opacity:.16;filter:grayscale(.5)}
      .su.pt-hit{opacity:1;filter:none;outline:2px solid rgba(111,140,255,.40)}

      /* Strict palette (HEX) */
      :root{--st-yellow:#FFC402;--st-orange:#FF8316;--st-cyan:#35C9E7;--st-blue:#007BE6;--st-green:#32D583;--st-red:#F04438;--st-purple:var(--accent-purple,#8B5CF6)}

      /* Racks (buttons) */
      .su[data-statuskey="yellow"]{background:var(--st-yellow);border-color:rgba(255,255,255,.18);color:#0b0f1a}
      .su[data-statuskey="orange"]{background:var(--st-orange);border-color:rgba(255,255,255,.18);color:#0b0f1a}
      .su[data-statuskey="cyan"]{background:var(--st-cyan);border-color:rgba(255,255,255,.18);color:#0b0f1a}
      .su[data-statuskey="blue"]{background:var(--st-blue);border-color:rgba(255,255,255,.18);color:#fff}
      .su[data-statuskey="green"]{background:var(--st-green);border-color:rgba(255,255,255,.18);color:#0b0f1a}
      .su[data-statuskey="red"]{background:var(--st-red);border-color:rgba(255,255,255,.18);color:#fff}
      .su[data-statuskey="purple"]{background:var(--st-purple);border-color:rgba(255,255,255,.18);color:#fff}

      /* Status select (only the closed control) */
      .pt-select.pt-status option{background:#0f1220;color:#e6e9f2}
      .pt-select.pt-status[data-statuskey="yellow"]{background:var(--st-yellow);color:#0b0f1a}
      .pt-select.pt-status[data-statuskey="orange"]{background:var(--st-orange);color:#0b0f1a}
      .pt-select.pt-status[data-statuskey="cyan"]{background:var(--st-cyan);color:#0b0f1a}
      .pt-select.pt-status[data-statuskey="blue"]{background:var(--st-blue);color:#fff}
      .pt-select.pt-status[data-statuskey="green"]{background:var(--st-green);color:#0b0f1a}
      .pt-select.pt-status[data-statuskey="red"]{background:var(--st-red);color:#fff}
      .pt-select.pt-status[data-statuskey="purple"]{background:var(--st-purple);color:#fff}
    `;
    const s=document.createElement("style");
    s.textContent=css;
    document.head.appendChild(s);
  }

  function findGroup(panel, labelStarts){
    const groups = Array.from(panel.querySelectorAll(".group"));
    return groups.find(g => norm(g.querySelector(".label")?.textContent||"").startsWith(norm(labelStarts)));
  }

  function bindSearch(panel){
    let inp = document.getElementById("ptSearch");
    if (inp) return inp;
    const g = findGroup(panel, "Search (SU / Rack)");
    if (g) {
      const existing = g.querySelector("input");
      if (existing) { existing.id="ptSearch"; existing.classList.add("pt-select"); return existing; }
    }
    return null;
  }

  function bindProcessSelect(panel){
    let sel = document.getElementById("ptProcess");
    if (sel) return sel;

    const g = findGroup(panel, "Process (filter / layout)");
    if (g) {
      const existing = g.querySelector("select");
      if (existing) {
        existing.id="ptProcess";
        existing.classList.add("pt-select");
        if (!existing.querySelector('option[value="ALL"]')) existing.insertAdjacentElement("afterbegin", opt("ALL","All"));
        if (existing.options.length < 3) ALL_PROCESSES.forEach(p=>existing.appendChild(opt(p,p)));
        return existing;
      }
    }
    return null;
  }

  function bindStatusSelect(panel){
    let sel = document.getElementById("ptStatus");
    let hint = document.getElementById("ptStatusHint");
    if (sel) { sel.classList.add("pt-select", "pt-status"); return { sel, hint }; }

    const g = findGroup(panel, "Status");
    if (!g) return null;

    const existing = g.querySelector("select");
    if (existing) {
      existing.id="ptStatus";
      existing.classList.add("pt-select", "pt-status");
      if (!hint) {
        hint = g.querySelector(".pt-hint") || document.createElement("div");
        hint.className = "pt-hint";
        hint.id = "ptStatusHint";
        if (!g.contains(hint)) g.appendChild(hint);
      }
      return { sel: existing, hint };
    }
    return null;
  }

  function ensureRackSelectInSelected(panel){
    let sel = document.getElementById("ptRack");
    let hint = document.getElementById("ptRackHint");
    let clearBtn = document.getElementById("ptClearSel");
    // Don't require hint blocks to exist (they are optional / can be hidden).
    // If the rack select and the existing Clear button are present in HTML, do not inject anything.
    if (sel && clearBtn) return { sel, hint, clearBtn };

    const g = findGroup(panel, "Selected");
    if (!g) return null;

    const wrap = document.createElement("div");
    wrap.style.marginTop = "10px";
    wrap.innerHTML = `
      <button class="btn-ghost" id="ptClearSel" type="button">Clear</button>
      <div style="height:10px"></div>
      <div class="label" style="margin-bottom:6px">Rack (within selected SU)</div>
      <select id="ptRack" class="pt-select" disabled></select>
      <div id="ptRackHint" class="pt-hint"></div>
    `;
    g.appendChild(wrap);

    sel = wrap.querySelector("#ptRack");
    hint = wrap.querySelector("#ptRackHint");
    clearBtn = wrap.querySelector("#ptClearSel");
    return { sel, hint, clearBtn };
  }

  function bindRackProcessSelect(){
    return {
      sel: document.getElementById("ptRackProcess"),
      hint: document.getElementById("ptRackProcessHint"),
    };
  }

  function bindViewToggle(panel, onChange){
    const headerSeg = document.getElementById("viewSeg");
    if (headerSeg) {
      const btns = Array.from(headerSeg.querySelectorAll("[data-view]"));
      if (btns.length) {
        function activate(btn){
          btns.forEach(b=>b.classList.remove("active"));
          btn.classList.add("active");
          onChange(btn.dataset.view === "rack" ? "rack" : "process");
        }
        btns.forEach(b=>b.addEventListener("click", ()=>activate(b)));
        const onBtn = btns.find(b=>b.classList.contains("active")) || btns[0];
        activate(onBtn);
        return;
      }
    }

    const g = findGroup(panel, "View");
    if (!g) return;
    const btns = Array.from(g.querySelectorAll(".seg"));
    if (btns.length < 2) return;

    function activate(btn){
      btns.forEach(b=>b.classList.remove("on"));
      btn.classList.add("on");
      onChange(norm(btn.textContent)==="RACK" ? "rack" : "process");
    }
    btns.forEach(b=>b.addEventListener("click", ()=>activate(b)));

    const onBtn = btns.find(b=>b.classList.contains("on")) || btns[1];
    activate(onBtn);
  }

  function computeSUStatusForProcess(suKey, proc){
    const racks = racksForSU(suKey);
    if (!racks.length) return null;

    if (proc === "ALL") {
      let max=1, blocked=false;
      for (const r of racks){
        for (const p of (r.processes||[])){
          const pk = resolveProcessKey(p);
          const tpl = PROCESS_TEMPLATES[pk];
          if (!tpl) continue;
          const c = getCode(suKey, r.id, pk);
          if (tpl[c] === "BLOCKED") blocked=true;
          if (c>max) max=c;
        }
      }
      return blocked ? 7 : max;
    }

    let found=false, max=1;
    for (const r of racks){
      if (canEditRackForProcess(r, proc)) {
        found=true;
        const c = getCode(suKey, r.id, proc);
        if (c>max) max=c;
      }
    }
    return found ? max : 1;
  }

  document.addEventListener("DOMContentLoaded", async function(){
    injectStyles();

    const panel = document.querySelector(".panel");
    if (!panel) return;

    const viewChip = document.querySelector(".top-actions .chip");
    const layoutChip = document.querySelector(".top-actions .chip-ghost");

    const searchInput = bindSearch(panel);
    const sideSearch = document.getElementById("ptSideSearch");
    const processSelect = bindProcessSelect(panel);
    const statusPack = bindStatusSelect(panel);
    const rackPack = ensureRackSelectInSelected(panel);
    const rackProcPack = bindRackProcessSelect();

    if (!processSelect || !statusPack || !rackPack || !rackProcPack?.sel) return;

    if (!processSelect.options || processSelect.options.length === 0) {
      processSelect.appendChild(opt("ALL", "All"));
      ALL_PROCESSES.forEach(p => processSelect.appendChild(opt(p, p)));
      processSelect.value = "ALL";
    } else if (!Array.from(processSelect.options).some(o => o.value === "ALL")) {
      processSelect.insertBefore(opt("ALL", "All"), processSelect.firstChild);
    }

    const statusSelect = statusPack.sel;
    const statusHint = statusPack.hint;

    const noteEl = document.getElementById("ptNote");
    const applyBtn = document.getElementById("ptApplyStatus");
    const applyHint = document.getElementById("ptApplyHint");

    const rackSelect = rackPack.sel;
    const rackHint = rackPack.hint;
    const clearBtn = rackPack.clearBtn;

    const rackProcessSelect = rackProcPack.sel;
    const rackProcessHint = rackProcPack.hint;

    attachTypeahead(processSelect);
    attachTypeahead(rackSelect);
    attachTypeahead(rackProcessSelect);
    attachTypeahead(statusSelect);

    const selectedTitle = panel.querySelector(".selected-title");
    const selectedSub = panel.querySelector(".selected-sub");

    const suEls = Array.from(document.querySelectorAll(".su"));

    function normKey(s){
      return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    }

    function attachTypeahead(sel){
      if (!sel) return;
      let buf = "";
      let t = null;
      function reset(){
        buf = "";
        if (t) { clearTimeout(t); t = null; }
      }
      function bestMatch(q){
        const qk = normKey(q);
        if (!qk) return null;
        const opts = Array.from(sel.options || []);
        let best = null;
        let bestScore = -1;
        for (const o of opts){
          const label = String(o.textContent || o.label || o.value || "");
          const ok = normKey(label);
          if (!ok) continue;
          let score = -1;
          if (ok === qk) score = 1000;
          else if (ok.startsWith(qk)) score = 900 - (ok.length - qk.length);
          else {
            const idx = ok.indexOf(qk);
            if (idx >= 0) score = 700 - idx;
            else {
              const raw = String(label || "").toLowerCase();
              const ridx = raw.indexOf(String(q || "").toLowerCase());
              if (ridx >= 0) score = 500 - ridx;
            }
          }
          if (score > bestScore) {
            bestScore = score;
            best = o;
          }
        }
        return best;
      }
      sel.addEventListener("blur", reset);
      sel.addEventListener("keydown", (e)=>{
        if (e.key === "Escape") { reset(); return; }
        if (e.key === "Backspace") {
          buf = buf.slice(0, -1);
        } else if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          buf += e.key;
        } else {
          return;
        }
        if (t) clearTimeout(t);
        t = setTimeout(reset, 700);
        const m = bestMatch(buf);
        if (m && m.value !== sel.value) {
          sel.value = m.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }

    const mapScroll = document.getElementById("mapScroll") || document.querySelector(".map-scroll");
    const matrixZoom = document.getElementById("matrixZoom");
    const matrixRoot = document.getElementById("matrixRoot") || document.querySelector(".matrix");
    const zoomInBtn = document.getElementById("zoomIn");
    const zoomOutBtn = document.getElementById("zoomOut");
    const zoomResetBtn = document.getElementById("zoomReset");
    const zoomPct = document.getElementById("zoomPct");

    let baseMatrixW = null;
    let baseMatrixH = null;
    let mapZoom = 1;

    function clampZoom(z){
      if (z < 0.6) return 0.6;
      if (z > 1.8) return 1.8;
      return z;
    }

    function ensureBaseMatrixSize(){
      if (!matrixRoot || baseMatrixW !== null) return;
      const prevTransform = matrixRoot.style.transform;
      matrixRoot.style.transform = "scale(1)";
      baseMatrixW = matrixRoot.offsetWidth;
      baseMatrixH = matrixRoot.offsetHeight;
      matrixRoot.style.transform = prevTransform;
    }

    function setMapZoom(z){
      if (!matrixRoot || !matrixZoom) return;
      ensureBaseMatrixSize();
      mapZoom = clampZoom(z);
      matrixRoot.style.transformOrigin = "0 0";
      matrixRoot.style.transform = "scale(" + mapZoom + ")";
      if (baseMatrixW !== null) matrixZoom.style.width = Math.round(baseMatrixW * mapZoom) + "px";
      if (baseMatrixH !== null) matrixZoom.style.height = Math.round(baseMatrixH * mapZoom) + "px";
      if (zoomPct) zoomPct.textContent = Math.round(mapZoom * 100) + "%";
    }

    SU_GPU_RACKS = buildGpuRacksFromSuEls(suEls);

    let viewMode = "process"; // rack | process
    let selected = null;      // { suKey, rackId }


    let pendingStatus = null;

    function noteStoreKey(suKey, rackId, proc){
      return `pt_note::${suKey}::${rackId}::${proc}`;
    }

    function getStoredNote(suKey, rackId, proc){
      try { return localStorage.getItem(noteStoreKey(suKey, rackId, proc)) || ""; }
      catch { return ""; }
    }

    function setStoredNote(suKey, rackId, proc, text){
      try {
        if (!text) localStorage.removeItem(noteStoreKey(suKey, rackId, proc));
        else localStorage.setItem(noteStoreKey(suKey, rackId, proc), String(text));
      } catch {}
    }

    // --- Responsible (who changed the status) ---
    const RESPONSIBLES = [
      "Admin",
      "Bata Khodzhiev",
      "Badma Matsakov",
      "Saigid Israfilov",
      "Sergei Olimov",
      "Sohibnazar Satorov",
      "Yahor Khizhniak",
      "Sergei Rumiantsev",
      "Aleksandr Tanygin",
      "Alinur Durusbekov",
      "Arman Ibyrkhanov",
      "Denis Mandzhiev",
      "Ihor Berezkyi",
      "Ihor Karbivnychyi",
      "Mamadali Mamadaliev",
      "Maria Arakelyan",
      "Nikita Hrachov",
      "Rovshan Akhmedov",
      "Ruslan Blahyi",
      "Valerii Smolentsev",
    ];

    function respStoreKey(suKey, rackId, proc){
      return `pt_resp::${suKey}::${rackId}::${proc}`;
    }

    function getStoredResp(suKey, rackId, proc){
      try { return localStorage.getItem(respStoreKey(suKey, rackId, proc)) || ""; }
      catch { return ""; }
    }

    function setStoredResp(suKey, rackId, proc, who){
      try {
        if (!who) localStorage.removeItem(respStoreKey(suKey, rackId, proc));
        else localStorage.setItem(respStoreKey(suKey, rackId, proc), String(who));
      } catch {}
    }

    function pickResponsible(){
      const modal = document.getElementById("ptRespModal");
      const sel = document.getElementById("ptRespSelect");
      const ok = document.getElementById("ptRespOk");
      const cancel = document.getElementById("ptRespCancel");

      if (!modal || !sel || !ok || !cancel) {
        const who = window.prompt("Who is responsible for this status change?\n" + RESPONSIBLES.join("\n"), "Admin");
        return Promise.resolve((who || "").trim() || null);
      }

      if (!sel.options || sel.options.length === 0) {
        RESPONSIBLES.forEach(name => {
          const o = document.createElement("option");
          o.value = name;
          o.textContent = name;
          sel.appendChild(o);
        });
      }

      modal.classList.add("open");
      sel.focus();

      return new Promise((resolve) => {
        const cleanup = () => {
          modal.classList.remove("open");
          ok.removeEventListener("click", onOk);
          cancel.removeEventListener("click", onCancel);
          modal.removeEventListener("click", onBackdrop);
          document.removeEventListener("keydown", onEsc);
        };

        const onOk = () => {
          const v = String(sel.value || "").trim();
          cleanup();
          resolve(v || null);
        };
        const onCancel = () => {
          cleanup();
          resolve(null);
        };
        const onBackdrop = (e) => {
          if (e.target === modal) onCancel();
        };
        const onEsc = (e) => {
          if (e.key === "Escape") onCancel();
        };

        ok.addEventListener("click", onOk);
        cancel.addEventListener("click", onCancel);
        modal.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onEsc);
      });
    }

    function getTargetProc(){
      if (viewMode !== "process") return null;
      if (!selected || !selected.suKey || !selected.rackId) return null;
      let targetProc = resolveProcessKey(rackProcessSelect && rackProcessSelect.value);
      if (!targetProc) {
        const proc = resolveProcessKey(processSelect.value);
        targetProc = (proc && proc !== "ALL") ? proc : null;
      }
      if (!targetProc || !PROCESS_TEMPLATES[targetProc]) return null;
      return targetProc;
    }

    function syncStatusSelectColor(){
      // Color only the closed status control (the option list stays dark).
      if (!statusSelect) return;
      const targetProc = getTargetProc();
      if (!targetProc) {
        statusSelect.removeAttribute("data-statuskey");
        return;
      }
      const tpl = PROCESS_TEMPLATES[targetProc];
      const code = Number(statusSelect.value);
      const label = tpl && tpl[code];
      if (!label) {
        statusSelect.removeAttribute("data-statuskey");
        return;
      }
      statusSelect.dataset.statuskey = statusLabelToKey(label);
    }

    function syncApplyUI(){
      const targetProc = getTargetProc();
      const ok = !!targetProc;

      if (noteEl) noteEl.disabled = !ok;
      if (!applyBtn) return;

      if (!ok) {
        applyBtn.disabled = true;
        if (applyHint) applyHint.textContent = (viewMode === "rack") ? "Rack view is read-only" : "Select a rack and process first";
        return;
      }

      const currentCode = String(getCode(selected.suKey, selected.rackId, targetProc));
      const chosen = String(statusSelect.value || currentCode);
      const noteChanged = !!noteEl && (String(noteEl.value || "") !== String(getStoredNote(selected.suKey, selected.rackId, targetProc) || ""));

      const changed = (chosen !== currentCode) || noteChanged;
      applyBtn.disabled = !changed;
      if (applyHint) applyHint.textContent = changed ? "Click Update Status to save" : "No changes to save";
    }

    function loadNoteForSelection(){
  try {
    if (!noteEl) return;

    // если ничего не выбрано — очищаем
    if (!selected || !selected.suKey || !selected.rackId) {
      noteEl.value = "";
      return;
    }

    const targetProc = getTargetProc();
    if (!targetProc || targetProc === "ALL") {
      noteEl.value = "";
      return;
    }

    const getter =
      (typeof window.getStoredNote === "function" ? window.getStoredNote : null) ||
      (typeof getStoredNote === "function" ? getStoredNote : null);

    const suRaw = String(selected.suKey || "").trim();
    const suNum = String(suNumFromKey(suRaw) || suRaw).replace(/^SU\s*/i, "").trim(); // "79"
    const suUI  = (typeof suKeyToUI === "function") ? suKeyToUI(suNum) : ("SU" + suNum);

    const rackRaw = String(selected.rackId || "").trim(); // часто "LPC-SU79"
    const rackBase =
      (typeof ptRackNameForDB === "function") ? ptRackNameForDB(rackRaw)
      : rackRaw.split("•")[0].trim().replace(/[-_\s]*SU\s*\d+$/i, "");

    const racks = Array.from(new Set([
      rackRaw,
      rackBase,
      (rackBase ? `${rackBase}-SU${suNum}` : null),
    ].filter(Boolean)));

    const sus = Array.from(new Set([suRaw, suNum, suUI].filter(Boolean)));

    // 1) try local cache first
    let v = "";
    if (getter) {
      for (const s of sus) {
        for (const r of racks) {
          const val = getter(s, r, targetProc);
          if (val != null && String(val).trim() !== "") {
            v = String(val);
            break;
          }
        }
        if (v) break;
      }
    }

    // apply what we have immediately
    if (String(noteEl.value || "") !== v) noteEl.value = v;

    // 2) fallback to backend truth if empty
    if (!v && window.PT_REST && typeof window.PT_REST.fetchJSON === "function") {
      const key = `${suNum}|${rackBase}|${targetProc}`;
      // анти-дребезг: не спамим lookup при каждом ререндере
      if (window.__PT_NOTE_LOOKUP_INFLIGHT__ === key) return;
      window.__PT_NOTE_LOOKUP_INFLIGHT__ = key;

      const url =
        `/api/runs/lookup?su_key=${encodeURIComponent(suNum)}` +
        `&rack_name=${encodeURIComponent(rackBase)}` +
        `&process_name=${encodeURIComponent(targetProc)}` +
        `&_=${Date.now()}`;

      window.PT_REST.fetchJSON(url)
        .then(row => {
          const backendNote = row && row.note != null ? String(row.note).trim() : "";
          if (backendNote) {
            // положим в локальный кэш, если есть setter
            const setter =
              (typeof window.setStoredNote === "function" ? window.setStoredNote : null) ||
              (typeof setStoredNote === "function" ? setStoredNote : null);

            if (setter) {
              // кладем под несколько ключей, чтобы UI точно нашёл
              for (const s of sus) for (const r of racks) setter(s, r, targetProc, backendNote);
            }

            // обновим textarea если пользователь не печатает прямо сейчас
            const isFocused = document.activeElement === noteEl;
            if (!isFocused || !String(noteEl.value || "").trim()) {
              noteEl.value = backendNote;
            }
          }
        })
        .catch(()=>{})
        .finally(() => {
          if (window.__PT_NOTE_LOOKUP_INFLIGHT__ === key) window.__PT_NOTE_LOOKUP_INFLIGHT__ = null;
        });
    }
  } catch (e) {
    console.warn("loadNoteForSelection failed:", e);
  }
}




    const problemsOnly = document.getElementById("problemsOnly");
    const qcOnly = document.getElementById("qcOnly");
    const processChipsEl = document.getElementById("ptProcessChips");

    const barNotStarted = document.getElementById("barNotStarted");
    const barInProgress = document.getElementById("barInProgress");
    const barQCDone = document.getElementById("barQCDone");
    const pctNotStarted = document.getElementById("pctNotStarted");
    const pctInProgress = document.getElementById("pctInProgress");
    const pctQCDone = document.getElementById("pctQCDone");
    const panelTitle = document.getElementById("ptPanelTitle");

    setMapZoom(1);
    if (zoomInBtn) zoomInBtn.addEventListener("click", ()=>setMapZoom(mapZoom + 0.1));
    if (zoomOutBtn) zoomOutBtn.addEventListener("click", ()=>setMapZoom(mapZoom - 0.1));
    if (zoomResetBtn) zoomResetBtn.addEventListener("click", ()=>setMapZoom(1));
    if (mapScroll) {
      mapScroll.addEventListener("wheel", (e)=>{
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        setMapZoom(mapZoom + (e.deltaY > 0 ? -0.08 : 0.08));
      }, { passive:false });
    }

    function setLayoutChip(proc){
      if (layoutChip) layoutChip.textContent = (proc === "ALL") ? "Process: All" : ("Process: " + proc);
      if (panelTitle) panelTitle.textContent = (proc === "ALL") ? "All processes" : proc;
    }

    function renderProcessChips(){
      if (!processChipsEl) return;
      processChipsEl.innerHTML = "";
      const items = ["ALL"].concat(ALL_PROCESSES);
for (const p of items){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pchip";
        btn.dataset.proc = p;
        btn.textContent = (p === "ALL") ? "All" : p;
        btn.addEventListener("click", ()=>{
          processSelect.value = p;
          processSelect.dispatchEvent(new Event("change", { bubbles: true }));
        });
        processChipsEl.appendChild(btn);
      }
      syncProcessChips();
    }

    function syncProcessChips(){
      if (!processChipsEl) return;
      const p = resolveProcessKey(processSelect.value);
      processChipsEl.querySelectorAll(".pchip").forEach(b=>{
        b.classList.toggle("active", b.dataset.proc === p);
      });
      setLayoutChip(p);
    }

    function updateSummaryBars(){
      const proc = resolveProcessKey(processSelect.value);

      // Rack view shows an aggregate rack-level summary across ALL processes.
      // (Status editing is disabled in rack view elsewhere.)
      if (viewMode === "rack") {
        let total = 0;
        let notStarted = 0;
        let inProg = 0;
        let qcDone = 0;

        const seen = new Set();
        for (const racks of Object.values(SU_RACKS)) {
          for (const r of (racks || [])) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);

            // Aggregate per rack: QC done if ALL mapped processes reached their completion code.
            // In progress if ANY mapped process has started (>1) but not all are QC done.
            const ps = (r.processes || []).map(x => resolveProcessKey(x)).filter(Boolean);
            if (!ps.length) continue;

            let allDone = true;
            let anyStarted = false;

            for (const pk of ps) {
              const tpl = PROCESS_TEMPLATES[pk];
              if (!tpl) continue;
              const completion = COMPLETION_CODE[pk] || 1;
              const c = getCode(null, r.id, pk);
              if (c > 1) anyStarted = true;
              if (c < completion) allDone = false;
            }

            total++;
            if (allDone) qcDone++;
            else if (anyStarted) inProg++;
            else notStarted++;
          }
        }

        const pct = (n)=> total ? Math.round((n / total) * 100) : 0;
        const p1 = pct(notStarted), p2 = pct(inProg), p3 = pct(qcDone);

        if (barNotStarted) barNotStarted.style.width = p1 + "%";
        if (barInProgress) barInProgress.style.width = p2 + "%";
        if (barQCDone) barQCDone.style.width = p3 + "%";
        if (pctNotStarted) pctNotStarted.textContent = p1 + "%";
        if (pctInProgress) pctInProgress.textContent = p2 + "%";
        if (pctQCDone) pctQCDone.textContent = p3 + "%";

        setLayoutChip("ALL");
        return;
      }

      // Process view: per-process summary (ALL is not shown/allowed)
      if (proc === "ALL") {
        // fallback (shouldn't happen in process view)
        if (barNotStarted) barNotStarted.style.width = "0%";
        if (barInProgress) barInProgress.style.width = "0%";
        if (barQCDone) barQCDone.style.width = "0%";
        if (pctNotStarted) pctNotStarted.textContent = "—";
        if (pctInProgress) pctInProgress.textContent = "—";
        if (pctQCDone) pctQCDone.textContent = "—";
        setLayoutChip(proc);
        return;
      }

      const completion = COMPLETION_CODE[proc] || 1;
      let total = 0;
      let notStarted = 0;
      let inProg = 0;
      let qcDone = 0;

      const seen = new Set();
      for (const racks of Object.values(SU_RACKS)) {
        for (const r of racks) {
          const key = r.id + "|" + proc;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!canEditRackForProcess(r, proc)) continue;
          total++;
          const c = getCode(null, r.id, proc);
          if (c <= 1) notStarted++;
          else if (c >= completion) qcDone++;
          else inProg++;
        }
      }

      const pct = (n)=> total ? Math.round((n / total) * 100) : 0;
      const p1 = pct(notStarted), p2 = pct(inProg), p3 = pct(qcDone);

      if (barNotStarted) barNotStarted.style.width = p1 + "%";
      if (barInProgress) barInProgress.style.width = p2 + "%";
      if (barQCDone) barQCDone.style.width = p3 + "%";
      if (pctNotStarted) pctNotStarted.textContent = p1 + "%";
      if (pctInProgress) pctInProgress.textContent = p2 + "%";
      if (pctQCDone) pctQCDone.textContent = p3 + "%";

      setLayoutChip(proc);
    }

    function setView(mode){
      viewMode = mode === "rack" ? "rack" : "process";

      // Sync header tabs (viewSeg) when view is changed programmatically.
      const viewSeg = document.getElementById("viewSeg");
      if (viewSeg) {
        const btns = Array.from(viewSeg.querySelectorAll("[data-view]"));
        btns.forEach(b=>{
          const isRack = (b.dataset.view === "rack");
          b.classList.toggle("active", (viewMode === "rack") ? isRack : !isRack);
        });
      }

      // Process selector rules:
      // - "All" should be available in BOTH views.
      // - In Rack view, choosing a specific process should automatically switch to Process view (handled in change listener).
      const hasAll = Array.from(processSelect.options || []).some(o => o.value === "ALL");
      if (!hasAll) processSelect.insertBefore(opt("ALL", "All"), processSelect.firstChild);
      if (!processSelect.value) processSelect.value = "ALL";

      // Re-render process chips so they match the dropdown.
      renderProcessChips(); 
      if (viewChip) viewChip.textContent = viewMode === "process" ? "Process view" : "Rack view";
      updateInteractivity();
      applyFilters();
      renderSelected();
      syncApplyUI();
    }

    bindViewToggle(panel, setView);

    renderProcessChips();

    function clearSelection(){
      selected = null;
      suEls.forEach(el=>el.classList.remove("pt-selected"));
      rackSelect.innerHTML = "";
      rackSelect.disabled = true;
      if (rackHint) rackHint.textContent = "Select SU to see racks";
      rackProcessSelect.innerHTML = "";
      rackProcessSelect.disabled = true;
      if (rackProcessHint) rackProcessHint.textContent = "Select a rack to see processes";

      if (noteEl) { noteEl.value = ""; noteEl.disabled = true; }
      if (applyBtn) applyBtn.disabled = true;
      if (applyHint) applyHint.textContent = "Choose a status, then click Update Status";
      renderSelected();
      updateInteractivity();
    }

    clearBtn.addEventListener("click", clearSelection);

    function fillStatusOptions(proc){
      statusSelect.innerHTML = "";
      if (proc === "ALL") return;
      const tpl = PROCESS_TEMPLATES[proc];
      if (!tpl) return;
      Object.keys(tpl).forEach(k => {
        const label = tpl[k];
        statusSelect.appendChild(opt(k, `${statusLabelToDot(label)} ${label}`));
      });
    }

    function listProcessesForRack(suKey, rackId){
      const rackObj = findRackInSU(suKey, rackId);
      const raw = (rackObj?.processes || []).map(resolveProcessKey);
      const out = [];
      const seen = new Set();
      for (const p of raw){
        if (!p || !PROCESS_TEMPLATES[p]) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        out.push(p);
      }
      return out;
    }

    function fillRackProcessOptions(){
      const prev = resolveProcessKey(rackProcessSelect && rackProcessSelect.value);
      rackProcessSelect.innerHTML = "";
      rackProcessSelect.disabled = true;
      if (rackProcessHint) rackProcessHint.textContent = "Select a rack to see processes";

      if (!selected || !selected.suKey || !selected.rackId) return;
      const procs = listProcessesForRack(selected.suKey, selected.rackId);
      if (!procs.length) {
        if (rackProcessHint) rackProcessHint.textContent = "No processes mapped for this rack";
        return;
      }
      procs.forEach(p => rackProcessSelect.appendChild(opt(p, p)));
      rackProcessSelect.disabled = false;
      if (rackProcessHint) rackProcessHint.textContent = "Pick a process (filtered to this rack)";

      const cur = resolveProcessKey(processSelect.value);
      if (prev && procs.includes(prev)) rackProcessSelect.value = prev;
      else rackProcessSelect.value = procs.includes(cur) ? cur : procs[0];
    }

    function updateInteractivity(){
      const proc = resolveProcessKey(processSelect.value);

      if (!selected){
        rackSelect.disabled = true;
        rackSelect.innerHTML = "";
        if (rackHint) rackHint.textContent = "Select SU to see racks";
        rackProcessSelect.disabled = true;
        rackProcessSelect.innerHTML = "";
        if (rackProcessHint) rackProcessHint.textContent = "Select a rack to see processes";
      }

      if (viewMode === "rack") {
        statusSelect.disabled = true;
        statusSelect.style.opacity = "0.65";
        statusSelect.removeAttribute("data-statuskey");
        if (statusHint) statusHint.textContent = "Rack view is read-only";
        return;
      }

      statusSelect.style.opacity = "1";
      if (proc === "ALL") {
        const editP = resolveProcessKey(rackProcessSelect && rackProcessSelect.value);
        const ok = !!(selected && selected.rackId && editP && PROCESS_TEMPLATES[editP]);
        statusSelect.disabled = !ok;
        if (statusHint) statusHint.textContent = ok ? "Applies to selected rack + selected process" : "Pick a rack, then a process";
        return;
      }

      statusSelect.disabled = !selected;
      if (statusHint) statusHint.textContent = selected ? "Applies to selected rack" : "Select SU + rack to edit";
    }

    function processFilterMatchesSU(suKey){
      const proc = resolveProcessKey(processSelect.value);
      if (proc === "ALL") return true;
      return hasProcessInSU(suKey, proc);
    }

    function parseSearchQuery(){
      const raw = (searchInput ? searchInput.value : "");
      const q = norm(raw);
      if (!q) return { kind: "none", q: "" };

      // Accept: "1", "01", "su1", "su01", "su 01", "SU096" -> SU 96
      const m = q.match(/^(?:su)?0*(\d{1,3})$/);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n >= 1 && n <= 96) return { kind: "su", su: String(n), q };
      }
      return { kind: "rack", q };
    }

    function rackMatchesQuery(rack, q){
      if (!q) return true;
      const tokens = [rack?.name, rack?.id, rack?.type];
      (rack?.aliases || []).forEach(a => tokens.push(a));
      return tokens.map(norm).some(t => t && t.includes(q));
    }

    function searchMatches(suKey, rack){
      const parsed = parseSearchQuery();
      if (parsed.kind === "none") return true;

      if (parsed.kind === "su") {
        if (!/^\d+$/.test(String(suKey))) return false;
        return String(Number(suKey)) === String(Number(parsed.su));
      }

      // rack search => only the rack matches
      const proc = resolveProcessKey(processSelect.value);
      if (proc !== "ALL" && !canEditRackForProcess(rack, proc)) return false;
      return rackMatchesQuery(rack, parsed.q);
    }
    function isBlockedForProc(suKey, rack, proc){
  if (!rack) return false;
  proc = resolveProcessKey(proc);

  if (proc === "ALL") {
    for (const p of (rack.processes || [])) {
      const pk = resolveProcessKey(p);
      const tpl = PROCESS_TEMPLATES[pk];
      if (!tpl) continue;
      const c = getCode(suKey, rack.id, pk);
      if (tpl[c] === "BLOCKED") return true;
    }
    return false;
  }

  if (!canEditRackForProcess(rack, proc)) return false;
  const tpl = PROCESS_TEMPLATES[proc];
  if (!tpl) return false;
  const c = getCode(suKey, rack.id, proc);
  return tpl[c] === "BLOCKED";
}

function isQCDoneForProc(suKey, rack, proc){
  if (!rack) return false;
  proc = resolveProcessKey(proc);

  if (proc === "ALL") {
    const procs = (rack.processes || [])
      .map(resolveProcessKey)
      .filter(p => PROCESS_TEMPLATES[p]);
    if (!procs.length) return false;

    for (const pk of procs) {
      const tpl = PROCESS_TEMPLATES[pk];
      const c = getCode(suKey, rack.id, pk);
      if (tpl[c] === "BLOCKED") return false;

      const completion = COMPLETION_CODE[pk] || 1;
      if (c < completion) return false;
    }
    return true;
  }

  if (!canEditRackForProcess(rack, proc)) return false;
  const tpl = PROCESS_TEMPLATES[proc];
  if (!tpl) return false;
  const c = getCode(suKey, rack.id, proc);
  if (tpl[c] === "BLOCKED") return false;

  const completion = COMPLETION_CODE[proc] || 1;
  return c >= completion;
}

    function applyFilters(){
      syncProcessChips();
      updateSummaryBars();

      const problems = !!(problemsOnly && problemsOnly.checked);
      const qc = !!(qcOnly && qcOnly.checked);

      const proc = resolveProcessKey(processSelect.value);

      suEls.forEach(el=>{
        const suKey = getSuKeyFromEl(el);
        const rack = rackForElement(el);

        const okProc = (proc === "ALL") ? true : canEditRackForProcess(rack, proc);
        const okSearch = searchMatches(suKey, rack);

        const code = computeRackStatusForProcess(suKey, rack, proc);
        if (code === null) {
          el.removeAttribute("data-statuscode");
          el.dataset.statuskey="default";
        } else {
          el.dataset.statuscode = String(code);
          // Strict coloring for racks:
          // - Process view: color by the selected process status.
          // - ALL: show a helpful aggregate (blocked > QC done > started > default).
          if (proc !== "ALL") {
            const tpl = PROCESS_TEMPLATES[proc];
            const label = tpl && tpl[code];
            if (label) el.dataset.statuskey = statusLabelToKey(label);
            else el.dataset.statuskey="default";
          } else {
            // ALL mode:
            // Show ONLY the two signal states on the map:
            //   - BLOCKED (red)
            //   - QC DONE (green)
            // Everything else should keep the base (static) rack color.
            if (isBlockedForProc(suKey, rack, "ALL")) {
              el.dataset.statuskey = "red";
            } else if (isQCDoneForProc(suKey, rack, "ALL")) {
              el.dataset.statuskey = "green";
            } else {
              // Do not override the original map styling for non-signal states
              el.removeAttribute("data-statuskey");
            }
          }
        }

        const okProblems = !problems || isBlockedForProc(suKey, rack, proc);
        const okQC = !qc || isQCDoneForProc(suKey, rack, proc);

        // Same behavior as process selection: keep the map unchanged,
        // just dim everything that doesn't match the active filters.
        const hit = okProc && okSearch && okProblems && okQC;
        el.style.display = "";
        el.classList.toggle("pt-dim", !hit);
        el.classList.toggle("pt-hit", hit && (searchInput && norm(searchInput.value)));
      });
    }

    function renderSelected(){
      const proc = resolveProcessKey(processSelect.value);

      function appendResponsible(procKey){
        if (!selectedSub || !selected || !selected.rackId || !procKey) return;
        const who = getStoredResp(selected.suKey, selected.rackId, procKey);
        if (!who) return;
        const cur = String(selectedSub.textContent || "").trim();
        selectedSub.textContent = cur ? (cur + " • Last changed by: " + who) : ("Last changed by: " + who);
      }

      if (!selected){
        if (selectedTitle) selectedTitle.textContent = "—";
        if (selectedSub) selectedSub.textContent = "";
        rackProcessSelect.innerHTML = "";
        rackProcessSelect.disabled = true;
        if (rackProcessHint) rackProcessHint.textContent = "Select a rack to see processes";
        updateInteractivity();
        loadNoteForSelection();
        syncApplyUI();
        return;
      }

      // Make the "Selected" header human-friendly.
      // For LU/ROW composite keys like "LU1_ROW12_SIS_T1" show only the meaningful tail ("SIS T1").
      // Keep the old behavior for numeric SUs and any other keys.
      let suLabel;
      if (selected.suKey && /^\d+$/.test(selected.suKey)) {
        suLabel = `SU ${selected.suKey}`;
      } else {
        const m = String(selected.suKey || "").match(/^LU\d+_ROW\d+_(.+)$/i);
        suLabel = (m ? m[1] : String(selected.suKey || "")).replaceAll('_', ' ');
      }
      const racks = racksForSU(selected.suKey);

      if (!racks.length){
        if (selectedTitle) selectedTitle.textContent = suLabel;
        if (selectedSub) selectedSub.textContent = "No racks mapped for this SU yet";
        rackSelect.disabled = true;
        rackSelect.innerHTML = "";
        if (rackHint) rackHint.textContent = "No racks";
        rackProcessSelect.innerHTML = "";
        rackProcessSelect.disabled = true;
        if (rackProcessHint) rackProcessHint.textContent = "No racks";
        updateInteractivity();
        loadNoteForSelection();
        syncApplyUI();
        return;
      }

      if (viewMode === "rack") {
        if (selectedTitle) selectedTitle.textContent = suLabel;

        const parts = racks.map(r=>{
          const ps = (r.processes||[]).map(p=>{
            const pk = resolveProcessKey(p);
            const tpl = PROCESS_TEMPLATES[pk];
            const c = getCode(suKey, r.id, pk);
            const label = tpl ? tpl[c] : "";
            return `${pk}: ${c}${label ? " ("+label+")" : ""}`;
          });
          return `${r.name} • ${r.type} • ${ps.join(", ")}`;
        });
        if (selectedSub) selectedSub.textContent = parts.join(" | ");

        rackSelect.innerHTML = "";
        racks.forEach(r=>rackSelect.appendChild(opt(r.id, `${r.name} • ${r.type}`)));
        rackSelect.disabled = true;
        if (rackHint) rackHint.textContent = "Rack view is read-only";

        rackProcessSelect.innerHTML = "";
        rackProcessSelect.disabled = true;
        if (rackProcessHint) rackProcessHint.textContent = "Rack view is read-only";
        fillStatusOptions(proc);
        updateInteractivity();
        loadNoteForSelection();
        syncApplyUI();
        return;
      }

      if (selectedTitle) selectedTitle.textContent = suLabel;

      if (proc === "ALL") {
        if (selectedSub) selectedSub.textContent = "Pick a rack, then choose a process (filtered to that rack)";

        // In ALL mode, allow choosing any rack, then show only that rack's processes
        rackSelect.innerHTML = "";
        racks.forEach(r => rackSelect.appendChild(opt(r.id, `${r.name} • ${r.type}`)));
        rackSelect.disabled = false;
        if (rackHint) rackHint.textContent = "Pick a rack";

        if (!selected.rackId || !racks.some(r => r.id === selected.rackId)) {
          selected.rackId = racks[0].id;
        }
        rackSelect.value = selected.rackId;

        fillRackProcessOptions();

        // In ALL mode, status editing is driven by the rack-scoped process selector.
        const editProc = resolveProcessKey(rackProcessSelect.value);
        if (editProc && PROCESS_TEMPLATES[editProc]) {
          fillStatusOptions(editProc);
          const code = getCode(selected.suKey, selected.rackId, editProc)
          statusSelect.value = String(code);
          syncStatusSelectColor();
          statusSelect.disabled = false;
          if (statusHint) statusHint.textContent = "Applies to selected rack + selected process";

          const rackObj = racks.find(r=>r.id===selected.rackId);
          const label = (PROCESS_TEMPLATES[editProc]||{})[code] || "";
          if (selectedSub) selectedSub.textContent = `${rackObj ? rackObj.name : "Rack"} • ${rackObj ? rackObj.type : ""} • ${editProc} • ${code}${label ? " — " + label : ""}`;
          appendResponsible(editProc);
        } else {
          statusSelect.disabled = true;
          statusSelect.removeAttribute("data-statuskey");
          if (statusHint) statusHint.textContent = "Choose a process to edit status";
          statusSelect.innerHTML = "";
        }

        updateInteractivity();
        loadNoteForSelection();
        syncApplyUI();
        return;
      }

      const eligible = racks.filter(r => canEditRackForProcess(r, proc));
      rackSelect.innerHTML = "";

      if (!eligible.length) {
        if (selectedSub) selectedSub.textContent = `No racks in this SU for process: ${proc}`;
        rackSelect.disabled = true;
        if (rackHint) rackHint.textContent = "No eligible racks";
        fillStatusOptions(proc);
        statusSelect.disabled = true;
        statusSelect.removeAttribute("data-statuskey");
        if (statusHint) statusHint.textContent = "No eligible rack for this process";
        loadNoteForSelection();
        syncApplyUI();
        return;
      }

      eligible.forEach(r => rackSelect.appendChild(opt(r.id, `${r.name} • ${r.type}`)));
      rackSelect.disabled = false;
      if (rackHint) rackHint.textContent = "Pick a rack to edit status";

      if (!selected.rackId || !eligible.some(r => r.id === selected.rackId)) {
        selected.rackId = eligible[0].id;
      }
      rackSelect.value = selected.rackId;

      fillRackProcessOptions();

      const editProc = resolveProcessKey(rackProcessSelect && rackProcessSelect.value) || proc;
      fillStatusOptions(editProc);
      const code = getCode(selected.suKey, selected.rackId, editProc)
      statusSelect.value = String(code);
      syncStatusSelectColor();
      statusSelect.disabled = false;
      if (statusHint) statusHint.textContent = "Applies to selected rack";

      const rack = eligible.find(r=>r.id===selected.rackId);
      const aliases = rack?.aliases?.length ? ` (aliases: ${rack.aliases.join(", ")})` : "";
      const label = (PROCESS_TEMPLATES[editProc]||{})[code] || "";
      if (selectedSub) selectedSub.textContent = `${rack ? rack.name : "Rack"}${aliases} • ${rack ? rack.type : ""} • ${editProc} • ${code}${label ? " — " + label : ""}`;

      appendResponsible(editProc);

      updateInteractivity();
      loadNoteForSelection();
      syncApplyUI();
    }

    suEls.forEach(el=>{
      el.addEventListener("click", ()=>{
        const suKey = getSuKeyFromEl(el);
        const code = (el.textContent||"").trim();
        suEls.forEach(x=>x.classList.remove("pt-selected"));
        el.classList.add("pt-selected");

        let rackId = null;
        if (code) {
          const racks = racksForSU(suKey);
          const hit = racks.find(r => norm(r.name) === norm(code));
          if (hit) rackId = hit.id;
        }
        selected = { suKey, rackId };
        renderSelected();
      });
    });

    rackSelect.addEventListener("change", ()=>{
      if (!selected) return;
      selected.rackId = rackSelect.value;
      renderSelected();
    });

    rackProcessSelect.addEventListener("change", ()=>{
      const p = resolveProcessKey(rackProcessSelect.value);
      if (!p) return;
      // Keep the map coloring in sync with the process you're editing,
      // so rack colors match the selected status.
      processSelect.value = p;
      applyFilters();
      renderSelected();
      syncApplyUI();
    });

    processSelect.addEventListener("change", ()=>{
      const p = resolveProcessKey(processSelect.value) || "ALL";

      // Behave like pressing "Clear" on every process switch:
      // reset selection (SU/rack/process/status UI), but keep the newly chosen process filter.
      clearSelection();
      processSelect.value = p;

      // If user picks a specific process while in Rack view -> switch to Process view automatically.
      if (viewMode === "rack" && p !== "ALL") {
        setView("process");
        processSelect.value = p;
      }

      syncProcessChips();
      applyFilters();
      renderSelected();
      syncApplyUI();
    });

    statusSelect.addEventListener("change", ()=>{
      syncStatusSelectColor();
      syncApplyUI();
    });

    if (noteEl) {
      noteEl.addEventListener("input", ()=>{
        syncApplyUI();
      });
    }

    if (applyBtn) {
      applyBtn.addEventListener("click", async ()=>{
        const targetProc = getTargetProc();
        if (!targetProc) return;

        const racks = racksForSU(selected.suKey);
        const rackObj = racks.find(r => r.id === selected.rackId);
        if (!canEditRackForProcess(rackObj, targetProc)) {
          renderSelected();
          return;
        }

        // Ask who is responsible for this change
        const who = await pickResponsible();
        if (!who) return;

        const newCode = String(statusSelect.value || "");
        if (newCode) setCode(selected.suKey, selected.rackId, targetProc, newCode);
        if (noteEl) setStoredNote(selected.suKey, selected.rackId, targetProc, String(noteEl.value || "").trim());
        setStoredResp(selected.suKey, selected.rackId, targetProc, who);

        applyFilters();
        renderSelected();
        syncApplyUI();
        try {
          if (applyHint) applyHint.textContent = "Saving...";
          await ptPersistToBackend(selected.suKey, selected.rackId, targetProc, newCode, noteEl ? String(noteEl.value || "").trim() : "");
          if (applyHint) applyHint.textContent = "Saved";
        } catch (e) {
          if (applyHint) applyHint.textContent = "Save failed";
          console.error(e);
        }
      });
    }

    // Keep header search and sidebar search in sync
    let syncingSearch = false;
    const onSearchInput = (e)=>{
      if (syncingSearch) return;
      syncingSearch = true;
      const v = String(e.target.value || "");
      if (searchInput && searchInput !== e.target) searchInput.value = v;
      if (sideSearch && sideSearch !== e.target) sideSearch.value = v;
      syncingSearch = false;
      applyFilters();
    };

    if (searchInput) searchInput.addEventListener("input", onSearchInput);
    if (sideSearch) sideSearch.addEventListener("input", onSearchInput);

    // Toggle filters should behave like the existing process filter:
    // keep the map intact and only change highlighting. Also make them
    // mutually exclusive to avoid the "zero matches" situation.
    if (problemsOnly) problemsOnly.addEventListener("change", ()=>{
      if (problemsOnly.checked && qcOnly) qcOnly.checked = false;
      applyFilters();
    });
    if (qcOnly) qcOnly.addEventListener("change", ()=>{
      if (qcOnly.checked && problemsOnly) problemsOnly.checked = false;
      applyFilters();
    });
    ptBootstrapFromBackend().then(function(){
      applyFilters();
      updateInteractivity();
      renderSelected();
      syncApplyUI();
    }).catch(function(){
      applyFilters();
      updateInteractivity();
      renderSelected();
      syncApplyUI();
    });
  });
})();
    
/* === DB Truth Sync Patch ===
   After any successful save, re-fetch runs from backend so UI reflects DB.
   Safe: if API fails, UI keeps local state.
*/
async function ptSyncRunsFromBackend(limitOverride) {
  try {
    const limit = Number(limitOverride || 20000);
    const url = "/api/runs?limit=" + encodeURIComponent(limit) + "&_=" + Date.now();
    const rows = await window.PT_REST.fetchJSON(url);
    if (Array.isArray(rows)) {
      if (typeof window.ptApplyBackendRowToUI === "function") {
        for (const row of rows) window.ptApplyBackendRowToUI(row);
      } else if (typeof ptApplyBackendRowToUI === "function") {
        for (const row of rows) ptApplyBackendRowToUI(row);
      } else {
        window.__PT_LAST_RUNS__ = rows;
      }
    }
  } catch (e) {
    console.warn("ptSyncRunsFromBackend failed:", e);
  }
}
window.ptSyncRunsFromBackend = ptSyncRunsFromBackend;
/* === end patch === */

/* === PT_V28_PATCH: prefer POST response 'updated' to refresh UI instantly; fallback to full sync only if needed === */
function ptApplyUpdatedFromPost(resp) {
  try {
    if (!resp) return false;
    // backend may return { ok:true, updated:{...} } or directly an object/array
    const row = resp.updated || resp.row || resp.run || resp;
    if (!row) return false;
    // if array, take first
    const one = Array.isArray(row) ? row[0] : row;
    if (!one || typeof one !== "object") return false;
    window.__PT_LAST_UPDATED__ = one;
    if (typeof window.ptApplyBackendRowToUI === "function") {
      window.ptApplyBackendRowToUI(one);
      return true;
    }
    if (typeof ptApplyBackendRowToUI === "function") {
      ptApplyBackendRowToUI(one);
      return true;
    }
    return false;
  } catch (e) {
    console.warn("ptApplyUpdatedFromPost failed:", e);
    return false;
  }
}

let __ptSyncTimer = null;
function ptScheduleSyncRuns(delayMs) {
  try {
    if (__ptSyncTimer) clearTimeout(__ptSyncTimer);
    __ptSyncTimer = setTimeout(() => {
      __ptSyncTimer = null;
      if (typeof window.ptSyncRunsFromBackend === "function") {
        window.ptSyncRunsFromBackend();
      }
    }, Math.max(0, Number(delayMs || 0)));
  } catch (e) {
    // ignore
  }
}
window.ptApplyUpdatedFromPost = ptApplyUpdatedFromPost;
window.ptScheduleSyncRuns = ptScheduleSyncRuns;
/* === end PT_V28_PATCH === */
