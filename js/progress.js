// js/progress_combined.js
(function () {
  // ==========================================================
  // 1. API & CONFIG (Back-end Logic)
  // ==========================================================
  const RESPONSIBLES = [
    "Admin", "Bata Khodzhiev", "Badma Matsakov", "Saigid Israfilov",
    "Sergei Olimov", "Sohibnazar Satorov", "Yahor Khizhniak", "Sergei Rumiantsev",
    "Aleksandr Tanygin", "Alinur Durusbekov", "Arman Ibyrkhanov", "Denis Mandzhiev",
    "Ihor Berezkyi", "Ihor Karbivnychyi", "Mamadali Mamadaliev", "Maria Arakelyan",
    "Nikita Hrachov", "Rovshan Akhmedov", "Ruslan Blahyi", "Valerii Smolentsev"
  ];

  function cleanBase(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function resolveBase() {
    const cfg = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL;
    if (cfg !== undefined && cfg !== null) return cleanBase(cfg);
    const fromStorage = localStorage.getItem("pt_api_base_url");
    if (fromStorage) return cleanBase(fromStorage);
    return "";
  }

  async function fetchJSON(pathOrUrl, opts = {}) {
    const base = resolveBase();
    const url = /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : base ? `${base}${pathOrUrl}` : pathOrUrl;

    const res = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });

    const text = await res.text();
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
    return fetchJSON("/api/views/v_rack_process_status");
  }

  async function apiUpdateRunStatus(rack_process_run_id, { status_id, responsible_employee_id, note } = {}) {
    if (window.PT_API && typeof window.PT_API.updateRunStatus === "function") {
      return window.PT_API.updateRunStatus(rack_process_run_id, { status_id, responsible_employee_id, note });
    }
    return fetchJSON("/api/runs/status", {
      method: "POST",
      body: JSON.stringify({ rack_process_run_id, status_id, responsible_employee_id, note }),
    });
  }

  // ==========================================================
  // 2. TEMPLATES & CONSTANTS
  // ==========================================================
  let LIVE_ROWS = [];
  const PROGRESS = {};

  const T_A_1_7 = { 1: "NOT STARTED", 2: "DRESSING IN PROGRESS", 3: "DRESSING DONE", 4: "PATCHING IN PROGRESS", 5: "PATCHING DONE", 6: "QC DONE", 7: "BLOCKED" };
  const T_B_1_5 = { 1: "NOT STARTED", 2: "IN PROGRESS", 3: "DONE", 4: "QC DONE", 5: "BLOCKED" };
  const T_IPMI_CAT6 = { 1: "NOT STARTED", 2: "PULLING IN PROGRESS", 3: "PATCHING IN PROGRESS", 4: "PATCHING DONE", 5: "TONING IS DONE", 6: "QC DONE", 7: "BLOCKED" };
  const T_GPU_AEC = { 1: "NOT STARTED", 2: "SIS IN PROGRESS", 3: "SIS IS DONE", 4: "FULL SET IN PROGRESS", 5: "FULL SET IS DONE", 6: "QC DONE", 7: "BLOCKED" };

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

  const PROCESS_BY_TYPE = {
    "SIS T1": ["SIS T1: AS-T1", "SIS T1-T2", "IPMI CAT6"],
    "ROCE T1": ["ROCE T1: AS-T1/R.T1-T2", "SU-MS IPMI", "IPMI JUMPERS LC-LC", "MS-MC T1 144F"],
    "ROCE T2": ["ROCE T2: R.T1-T2", "R.T2-T3", "IPMI CAT6"],
    "GPU": ["GPU AEC", "GPU CAT6"],
    "IPMI MC": ["MS-MC NA15/NB15", "MC-MF NM09-NL09", "IPMI CAT6"],
    "SIS NM": ["IPMI CAT6"],
  };

  // ==========================================================
  // 3. DATA STRUCTURES (Fixed SU_RACKS)
  // ==========================================================
  const SU_RACKS = (function () {
    return {
      "1": [{ id: "LAC-SU1", name: "LAC", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU1", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "2": [{ id: "LAH-SU2", name: "LAH", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU2", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "3": [{ id: "LAM-SU3", name: "LAM", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU3", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "4": [{ id: "LAR-SU4", name: "LAR", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU4", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "5": [{ id: "LAW-SU5", name: "LAW", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU5", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "6": [{ id: "LBB-SU6", name: "LBB", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU6", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "7": [{ id: "LBG-SU7", name: "LBG", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU7", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "8": [{ id: "LBL-SU8", name: "LBL", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU8", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "9": [{ id: "LBQ-SU9", name: "LBQ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU9", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "10": [{ id: "LBV-SU10", name: "LBV", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU10", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "11": [{ id: "LCA-SU11", name: "LCA", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU11", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "12": [{ id: "LCF-SU12", name: "LCF", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU12", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "13": [{ id: "LCK-SU13", name: "LCK", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU13", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "14": [{ id: "LCP-SU14", name: "LCP", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU14", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "15": [{ id: "LCU-SU15", name: "LCU", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU15", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "16": [{ id: "LCZ-SU16", name: "LCZ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU16", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "17": [{ id: "LDE-SU17", name: "LDE", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU17", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "18": [{ id: "LDJ-SU18", name: "LDJ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU18", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "19": [{ id: "LDO-SU19", name: "LDO", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU19", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "20": [{ id: "LDT-SU20", name: "LDT", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU20", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "21": [{ id: "LDY-SU21", name: "LDY", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU21", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "22": [{ id: "LED-SU22", name: "LED", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU22", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "23": [{ id: "LEI-SU23", name: "LEI", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU23", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "24": [{ id: "LEN-SU24", name: "LEN", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU24", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "25": [{ id: "LES-SU25", name: "LES", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU25", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "26": [{ id: "LEX-SU26", name: "LEX", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU26", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "27": [{ id: "LFC-SU27", name: "LFC", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU27", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "28": [{ id: "LFH-SU28", name: "LFH", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU28", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "29": [{ id: "LFM-SU29", name: "LFM", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU29", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "30": [{ id: "LFR-SU30", name: "LFR", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU30", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "31": [{ id: "LFW-SU31", name: "LFW", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU31", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "32": [{ id: "LGB-SU32", name: "LGB", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU32", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "33": [{ id: "LGG-SU33", name: "LGG", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU33", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "34": [{ id: "LGL-SU34", name: "LGL", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU34", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "35": [{ id: "LGQ-SU35", name: "LGQ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU35", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "36": [{ id: "LGV-SU36", name: "LGV", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU36", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "37": [{ id: "LHA-SU37", name: "LHA", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU37", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "38": [{ id: "LHF-SU38", name: "LHF", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU38", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "39": [{ id: "LHK-SU39", name: "LHK", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU39", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "40": [{ id: "LHP-SU40", name: "LHP", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU40", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "41": [{ id: "LHU-SU41", name: "LHU", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU41", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "42": [{ id: "LHZ-SU42", name: "LHZ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU42", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "43": [{ id: "LIE-SU43", name: "LIE", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU43", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "44": [{ id: "LIJ-SU44", name: "LIJ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU44", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "45": [{ id: "LIO-SU45", name: "LIO", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU45", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "46": [{ id: "LIT-SU46", name: "LIT", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU46", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "47": [{ id: "LIY-SU47", name: "LIY", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU47", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "48": [{ id: "LJD-SU48", name: "LJD", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU48", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "49": [{ id: "LJI-SU49", name: "LJI", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU49", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "50": [{ id: "LJN-SU50", name: "LJN", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU50", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "51": [{ id: "LJS-SU51", name: "LJS", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU51", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "52": [{ id: "LJX-SU52", name: "LJX", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU52", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "53": [{ id: "LKC-SU53", name: "LKC", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU53", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "54": [{ id: "LKH-SU54", name: "LKH", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU54", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "55": [{ id: "LKM-SU55", name: "LKM", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU55", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "56": [{ id: "LKR-SU56", name: "LKR", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU56", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "57": [{ id: "LKW-SU57", name: "LKW", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU57", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "58": [{ id: "LLB-SU58", name: "LLB", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU58", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "59": [{ id: "LLG-SU59", name: "LLG", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU59", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "60": [{ id: "LLL-SU60", name: "LLL", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU60", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "61": [{ id: "LLQ-SU61", name: "LLQ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU61", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "62": [{ id: "LLV-SU62", name: "LLV", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU62", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "63": [{ id: "LMA-SU63", name: "LMA", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU63", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "64": [{ id: "LMF-SU64", name: "LMF", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU64", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "65": [{ id: "LMK-SU65", name: "LMK", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU65", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "66": [{ id: "LMP-SU66", name: "LMP", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU66", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "67": [{ id: "LMU-SU67", name: "LMU", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU67", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "68": [{ id: "LMZ-SU68", name: "LMZ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU68", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "69": [{ id: "LNE-SU69", name: "LNE", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU69", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "70": [{ id: "LNJ-SU70", name: "LNJ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU70", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "71": [{ id: "LNO-SU71", name: "LNO", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU71", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "72": [{ id: "LNT-SU72", name: "LNT", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU72", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "73": [{ id: "LNY-SU73", name: "LNY", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU73", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "74": [{ id: "LOD-SU74", name: "LOD", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU74", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "75": [{ id: "LOI-SU75", name: "LOI", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU75", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "76": [{ id: "LON-SU76", name: "LON", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU76", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "77": [{ id: "LOS-SU77", name: "LOS", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU77", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "78": [{ id: "LOX-SU78", name: "LOX", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU78", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "79": [{ id: "LPC-SU79", name: "LPC", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU79", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "80": [{ id: "LPH-SU80", name: "LPH", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU80", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "81": [{ id: "LPM-SU81", name: "LPM", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU81", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "82": [{ id: "LPR-SU82", name: "LPR", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU82", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "83": [{ id: "LPW-SU83", name: "LPW", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU83", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "84": [{ id: "LQB-SU84", name: "LQB", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU84", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "85": [{ id: "LQG-SU85", name: "LQG", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU85", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "86": [{ id: "LQL-SU86", name: "LQL", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU86", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "87": [{ id: "LQQ-SU87", name: "LQQ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU87", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "88": [{ id: "LQV-SU88", name: "LQV", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU88", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "89": [{ id: "LRA-SU89", name: "LRA", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU89", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "90": [{ id: "LRF-SU90", name: "LRF", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []), aliases: ["LHM"] }, { id: "GPU-SU90", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "91": [{ id: "LRK-SU91", name: "LRK", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU91", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "92": [{ id: "LRP-SU92", name: "LRP", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU92", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "93": [{ id: "LRU-SU93", name: "LRU", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU93", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "94": [{ id: "LRZ-SU94", name: "LRZ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU94", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "95": [{ id: "LSE-SU95", name: "LSE", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU95", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
      "96": [{ id: "LSJ-SU96", name: "LSJ", type: "ROCE T1", processes: (PROCESS_BY_TYPE["ROCE T1"] || []) }, { id: "GPU-SU96", name: "GPU", type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) }],
    };
  })();

  const CELL_RACKS = {
    "LU1_ROW12_SIS_T1": [{ id: "NA29", name: "NA29", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }],
    "LU1_ROW12_SIS_NM": [{ id: "NA05", name: "NA28", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU1_ROW13_SIS_T1": [{ id: "NB29", name: "NB29", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU1_ROW13_SIS_NM": [{ id: "NB28", name: "NB28", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU2_ROW12_ROCE_T2_RAIL1": [{ id: "NA24", name: "NA24", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA25", name: "NA25", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA26", name: "NA26", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA27", name: "NA27", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }],
    "LU2_ROW13_ROCE_T2_RAIL1": [{ id: "NB24", name: "NB24", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB25", name: "NB25", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB26", name: "NB26", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB27", name: "NB27", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }],
    "LU3_ROW12_SIS_T1": [{ id: "NA22", name: "NA22", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }, { id: "NA23", name: "NA23", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }],
    "LU3_ROW12_SIS_NM": [{ id: "NA21", name: "NA21", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU3_ROW13_SIS_T1": [{ id: "NB22", name: "NB22", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }, { id: "NB23", name: "NB23", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }],
    "LU3_ROW13_SIS_NM": [{ id: "NB21", name: "NB21", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU4_ROW12_ROCE_T2_RAIL2": [{ id: "NA17", name: "NA17", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA18", name: "NA18", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA19", name: "NA19", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA20", name: "NA20", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }],
    "LU4_ROW13_ROCE_T2_RAIL2": [{ id: "NB17", name: "NB17", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB18", name: "NB18", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB19", name: "NB19", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB20", name: "NB20", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }],
    "LU5_ROW12_IPMI_MC": [{ id: "NA15", name: "NA15", type: "IPMI MC", processes: (PROCESS_BY_TYPE["IPMI MC"] || []) }],
    "LU5_ROW12_SIS_NM": [{ id: "NA14", name: "NA14", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU5_ROW12_SIS_T1": [{ id: "NA16", name: "NA16", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }],
    "LU5_ROW13_IPMI_MC": [{ id: "NB15", name: "NB15", type: "IPMI MC", processes: (PROCESS_BY_TYPE["IPMI MC"] || []) }],
    "LU5_ROW13_SIS_NM": [{ id: "NB14", name: "NB14", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU5_ROW13_SIS_T1": [{ id: "NB16", name: "NB16", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }],
    "LU6_ROW12_SIS_T1": [{ id: "NA12", name: "NA12", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }, { id: "NA13", name: "NA13", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }],
    "LU6_ROW12_SIS_NM": [{ id: "NA11", name: "NA11", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU6_ROW13_SIS_T1": [{ id: "NB12", name: "NB12", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }, { id: "NB13", name: "NB13", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }],
    "LU6_ROW13_SIS_NM": [{ id: "NB11", name: "NB11", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU7_ROW12_ROCE_T2_RAIL3": [{ id: "NA07", name: "NA07", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA08", name: "NA08", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA09", name: "NA09", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA10", name: "NA10", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }],
    "LU7_ROW13_ROCE_T2_RAIL3": [{ id: "NB07", name: "NB07", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB08", name: "NB08", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB09", name: "NB09", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB10", name: "NB10", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }],
    "LU8_ROW12_SIS_T1": [{ id: "NA06", name: "NA06", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }],
    "LU8_ROW12_SIS_NM": [{ id: "NA05", name: "NA05", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU8_ROW13_SIS_T1": [{ id: "NB06", name: "NB06", type: "SIS T1", processes: (PROCESS_BY_TYPE["SIS T1"] || []) }],
    "LU8_ROW13_SIS_NM": [{ id: "NB05", name: "NB05", type: "SIS NM", processes: (PROCESS_BY_TYPE["SIS NM"] || []) }],
    "LU9_ROW12_ROCE_T2_RAIL4": [{ id: "NA01", name: "NA01", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA02", name: "NA02", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA03", name: "NA03", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NA04", name: "NA04", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }],
    "LU9_ROW13_ROCE_T2_RAIL4": [{ id: "NB01", name: "NB01", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB02", name: "NB02", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB03", name: "NB03", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }, { id: "NB04", name: "NB04", type: "ROCE T2", processes: (PROCESS_BY_TYPE["ROCE T2"] || []) }],
  };

  let SU_GPU_RACKS = null;

  // ==========================================================
  // 4. HELPERS
  // ==========================================================
  function normalizeRackBase(row) {
    let s = (row && (row.rack_name || row.name || row.rack || row.rack_id || row.rackId || "")) + "";
    s = s.trim();
    if (s.includes(" - ")) s = s.split(" - ")[0].trim();
    return s;
  }

  function normalizeProcessName(row) {
    return ((row && (row.process_name || row.process || row.proc || "")) + "").trim();
  }

  function statusToCode(templateObj, statusLabel) {
    const label = ((statusLabel || "") + "").trim().toLowerCase();
    if (!label) return 1;

    for (const [code, txt] of Object.entries(templateObj)) {
      if ((txt + "").trim().toLowerCase() === label) return Number(code);
    }
    for (const [code, txt] of Object.entries(templateObj)) {
      const t = (txt + "").trim().toLowerCase();
      if (t.includes(label) || label.includes(t)) return Number(code);
    }

    if (label.includes("not start")) return 1;
    if (label.includes("qc done") || label === "done") return 6;
    if (label.includes("block")) return 7;

    return 1;
  }

  function normalizeStatusCodeFromLabel(labelUpper) {
    const label = String(labelUpper || "").trim().toUpperCase();
    if (!label) return null;
    for (const tpl of Object.values(PROCESS_TEMPLATES)) {
      for (let i = 1; i <= 7; i++) {
        const v = (tpl?.[i] || "").toString().trim().toUpperCase();
        if (v && v === label) return i;
      }
    }
    if (label.includes("NOT START")) return 1;
    if (label.includes("QC DONE") || label === "DONE") return 6;
    if (label.includes("BLOCK")) return 7;
    return null;
  }

  function statusLabelToKey(label) {
    const t = String(label || "").toLowerCase().trim();

    const keys = new Set(["yellow", "orange", "cyan", "blue", "green", "red", "purple", "default"]);
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


  function statusLabelToDot(label) {
    const k = statusLabelToKey(label);
    return ({
      yellow: "🟡",
      orange: "🟠",
      cyan: "🔵",
      blue: "🔷",
      green: "🟢",
      red: "🔴",
      purple: "🟣",
      default: "⚪",
    })[k] || "⚪";
  }

  function cellKeyHash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  async function syncProgressFromBackend() {
    try {
      const rows = await apiGetRackProcessStatus();
      LIVE_ROWS = Array.isArray(rows) ? rows : [];

      for (const r of LIVE_ROWS) {
        const base = normalizeRackBase(r);
        const proc = normalizeProcessName(r);
        const statusLabel = r.current_status || r.status || r.status_name || r.state;
        if (!base || !proc) continue;
        const tpl = PROCESS_TEMPLATES[proc];
        if (!tpl) continue;
        const code = statusToCode(tpl, statusLabel);
        PROGRESS[`${base}|${proc}`] = code;
      }
      console.log("✅ Synced", LIVE_ROWS.length, "rows from backend.");
    } catch (e) {
      console.warn("syncProgressFromBackend failed:", e);
    }
  }

  // ==========================================================
  // 5. UI LOGIC
  // ==========================================================
  function injectStyles() {
    const css = `
      .pt-select{width:100%;height:40px;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.18);color:#fff;padding:0 10px;font-weight:800}
      .pt-hint{margin-top:8px;color:rgba(255,255,255,.55);font-size:12px;font-weight:800}
      .pt-btn{height:34px;padding:0 12px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.18);color:#fff;font-weight:900;cursor:pointer}
      .pt-btn:hover{filter:brightness(1.06)}
      .su{cursor:pointer;transition:opacity .15s ease,filter .15s ease,outline .15s ease}
      .su.pt-selected{outline:2px solid rgba(111,140,255,.60);box-shadow:0 0 0 6px rgba(111,140,255,.10);opacity:1 !important;filter:none !important}
      .su.pt-dim{opacity:.16;filter:grayscale(.5)}
      .su.pt-hit{opacity:1;filter:none;outline:2px solid rgba(111,140,255,.40)}
      :root{--st-yellow:#FFC402;--st-orange:#FF8316;--st-cyan:#35C9E7;--st-blue:#007BE6;--st-green:#32D583;--st-red:#F04438;--st-purple:var(--accent-purple,#8B5CF6)}
      .su[data-statuskey="yellow"]{background:var(--st-yellow);border-color:rgba(255,255,255,.18);color:#0b0f1a}
      .su[data-statuskey="orange"]{background:var(--st-orange);border-color:rgba(255,255,255,.18);color:#0b0f1a}
      .su[data-statuskey="cyan"]{background:var(--st-cyan);border-color:rgba(255,255,255,.18);color:#0b0f1a}
      .su[data-statuskey="blue"]{background:var(--st-blue);border-color:rgba(255,255,255,.18);color:#fff}
      .su[data-statuskey="green"]{background:var(--st-green);border-color:rgba(255,255,255,.18);color:#0b0f1a}
      .su[data-statuskey="red"]{background:var(--st-red);border-color:rgba(255,255,255,.18);color:#fff}
      .su[data-statuskey="purple"]{background:var(--st-purple);border-color:rgba(255,255,255,.18);color:#fff}
      .pt-select.pt-status option{background:#0f1220;color:#e6e9f2}
      .pt-select.pt-status[data-statuskey="yellow"]{background:var(--st-yellow);color:#0b0f1a}
      .pt-select.pt-status[data-statuskey="orange"]{background:var(--st-orange);color:#0b0f1a}
      .pt-select.pt-status[data-statuskey="cyan"]{background:var(--st-cyan);color:#0b0f1a}
      .pt-select.pt-status[data-statuskey="blue"]{background:var(--st-blue);color:#fff}
      .pt-select.pt-status[data-statuskey="green"]{background:var(--st-green);color:#0b0f1a}
      .pt-select.pt-status[data-statuskey="red"]{background:var(--st-red);color:#fff}
      .pt-select.pt-status[data-statuskey="purple"]{background:var(--st-purple);color:#fff}
    `;
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  function pickResponsible() {
    const modal = document.getElementById("ptRespModal");
    const sel = document.getElementById("ptRespSelect");
    const ok = document.getElementById("ptRespOk");
    const cancel = document.getElementById("ptRespCancel");

    if (!modal || !sel || !ok || !cancel) {
      const who = window.prompt("Who is responsible?\n" + RESPONSIBLES.join("\n"), "Admin");
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
        ok.onclick = null;
        cancel.onclick = null;
      };
      ok.onclick = () => {
        const v = String(sel.value || "").trim();
        cleanup();
        resolve(v || null);
      };
      cancel.onclick = () => {
        cleanup();
        resolve(null);
      };
    });
  }

  function norm(s) { return (s || "").toString().trim().toUpperCase(); }
  function opt(v, t) { const o = document.createElement("option"); o.value = v; o.textContent = t; return o; }
  function resolveProcessKey(v) {
    if (!v) return "ALL";
    if (v === "ALL") return "ALL";
    const q = norm(v);
    for (const k of ALL_PROCESSES) if (norm(k) === q) return k;
    return v;
  }
  function getSuKeyFromEl(el) {
    const ds = el.dataset && el.dataset.su;
    if (ds) return ds;
    const t = (el.textContent || "").trim();
    const m = t.match(/SU\s*([0-9]+)/i);
    return m ? m[1] : t;
  }
  function racksForSU(suKey) {
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
  function buildGpuRacksFromSuEls(suEls) {
    const out = {};
    const bySu = {};
    suEls.forEach(el => {
      const suKey = getSuKeyFromEl(el);
      if (!/^\d+$/.test(suKey)) return;
      const code = (el.textContent || "").trim();
      if (!code) return;
      (bySu[suKey] ||= new Set()).add(code);
    });
    for (const [suKey, set] of Object.entries(bySu)) {
      const master = (SU_RACKS[suKey] || []).find(r => norm(r.type) === "ROCE T1");
      const masterName = master ? norm(master.name) : null;
      out[suKey] = Array.from(set).filter(code => !masterName || norm(code) !== masterName).map(code => ({ id: `${code}-SU${suKey}`, name: code, type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) })).sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
  }
  function rackForElement(el) {
    const suKey = getSuKeyFromEl(el);
    const proc = resolveProcessKey((document.getElementById("ptProcess") || {}).value);
    const code = (el.textContent || "").trim();
    const racks = racksForSU(suKey);
    if (/^\d+$/.test(suKey) && code) {
      const hit = racks.find(r => norm(r.name) === norm(code));
      if (hit) return hit;
      return { id: `${code}-SU${suKey}`, name: code, type: "GPU", processes: (PROCESS_BY_TYPE["GPU"] || []) };
    }
    if (code) {
      const hit = racks.find(r => norm(r.name) === norm(code) || norm(r.id) === norm(code) || (r.aliases || []).some(a => norm(a) === norm(code)));
      if (hit) return hit;
    }
    if (proc !== "ALL") {
      const elig = racks.find(r => canEditRackForProcess(r, proc));
      if (elig) return elig;
    }
    return racks[0] || null;
  }
  function canEditRackForProcess(rack, proc) {
    return !!rack && proc !== "ALL" && (rack.processes || []).some(p => norm(p) === norm(proc));
  }
  function getCode(suKey, rackId, proc) {
    proc = resolveProcessKey(proc);
    const k = `${rackId}|${proc}`;
    if (!k) return 1;
    if (PROGRESS[k] != null) return PROGRESS[k];
    const base = String(rackId).split('@')[0];
    if (base && base !== rackId) {
      const k2 = `${base}|${proc}`;
      if (PROGRESS[k2] != null) return PROGRESS[k2];
    }
    return 1;
  }
  function isBlockedForProc(suKey, rack, proc) {
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
  function isQCDoneForProc(suKey, rack, proc) {
    if (!rack) return false;
    proc = resolveProcessKey(proc);
    if (proc === "ALL") {
      const procs = (rack.processes || []).map(resolveProcessKey).filter(p => PROCESS_TEMPLATES[p]);
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

  // ==========================================================
  // 6. MAIN EXECUTION
  // ==========================================================
  document.addEventListener("DOMContentLoaded", async function () {
    injectStyles();
    await syncProgressFromBackend();

    const panel = document.querySelector(".panel");
    const suEls = Array.from(document.querySelectorAll(".su"));
    SU_GPU_RACKS = buildGpuRacksFromSuEls(suEls);

    const rackSelect = document.getElementById("ptRack");
    const processSelect = document.getElementById("ptProcess");
    const statusSelect = document.getElementById("ptStatus");
    const rackProcessSelect = document.getElementById("ptRackProcess");
    const applyBtn = document.getElementById("ptApplyStatus");
    const ptApplyHint = document.getElementById("ptApplyHint");
    const noteEl = document.getElementById("ptNote");
    const clearBtn = document.getElementById("ptClearSel");

    let selected = null;
    let viewMode = "process";

    // --- Fill Selectors ---
    if (processSelect && (!processSelect.options || processSelect.options.length === 0)) {
      processSelect.appendChild(opt("ALL", "All"));
      ALL_PROCESSES.forEach(p => processSelect.appendChild(opt(p, p)));
      processSelect.value = "ALL";
    }

    // --- Core Functions ---
    function applyFilters() {
      const proc = resolveProcessKey(processSelect.value);
      suEls.forEach(el => {
        const suKey = getSuKeyFromEl(el);
        const rack = rackForElement(el);
        const code = proc === "ALL" ? 1 : getCode(suKey, rack ? rack.id : null, proc);

        if (proc !== "ALL") {
          const tpl = PROCESS_TEMPLATES[proc];
          if (tpl && tpl[code]) el.dataset.statuskey = statusLabelToKey(tpl[code]);
          else el.dataset.statuskey = "default";
        } else {
          if (isBlockedForProc(suKey, rack, "ALL")) el.dataset.statuskey = "red";
          else if (isQCDoneForProc(suKey, rack, "ALL")) el.dataset.statuskey = "green";
          else el.removeAttribute("data-statuskey");
        }
      });
    }

    function renderSelected() {
      if (!selected) {
        rackSelect.innerHTML = ""; rackSelect.disabled = true;
        rackProcessSelect.innerHTML = ""; rackProcessSelect.disabled = true;
        statusSelect.innerHTML = ""; statusSelect.disabled = true;
        return;
      }
      const racks = racksForSU(selected.suKey);
      rackSelect.innerHTML = "";
      racks.forEach(r => rackSelect.appendChild(opt(r.id, `${r.name} • ${r.type}`)));
      rackSelect.value = selected.rackId;
      rackSelect.disabled = false;

      // Fill processes for this rack
      const rackObj = racks.find(r => r.id === selected.rackId);
      const procs = rackObj ? (rackObj.processes || []) : [];
      rackProcessSelect.innerHTML = "";
      procs.forEach(p => rackProcessSelect.appendChild(opt(p, p)));
      rackProcessSelect.disabled = false;

      // Update status select based on active process
      const activeProc = resolveProcessKey(rackProcessSelect.value || processSelect.value);
      if (activeProc && activeProc !== "ALL") {
        statusSelect.innerHTML = "";
        const tpl = PROCESS_TEMPLATES[activeProc];
        if (tpl) Object.keys(tpl).forEach(k => statusSelect.appendChild(opt(k, tpl[k])));
        statusSelect.value = String(getCode(selected.suKey, selected.rackId, activeProc));
        statusSelect.disabled = false;
      } else {
        statusSelect.innerHTML = ""; statusSelect.disabled = true;
      }
    }

    // --- Events ---
    suEls.forEach(el => {
      el.addEventListener("click", () => {
        const suKey = getSuKeyFromEl(el);
        const rack = rackForElement(el);
        selected = { suKey, rackId: rack ? rack.id : null };
        renderSelected();
      });
    });

    if (rackSelect) rackSelect.addEventListener("change", () => {
      if (selected) { selected.rackId = rackSelect.value; renderSelected(); }
    });

    if (processSelect) processSelect.addEventListener("change", () => {
      applyFilters(); renderSelected();
    });

    if (rackProcessSelect) rackProcessSelect.addEventListener("change", () => {
      renderSelected();
    });

    if (clearBtn) clearBtn.addEventListener("click", () => {
      selected = null; renderSelected();
    });

    // --- The Merged Save Logic ---
    if (applyBtn) {
      applyBtn.addEventListener("click", async () => {
        try {
          const who = await pickResponsible();
          if (!who) { if (ptApplyHint) ptApplyHint.textContent = "Responsible is required."; return; }

          const rackName = rackSelect.options[rackSelect.selectedIndex]?.textContent?.split("•")[0]?.trim() || rackSelect.value;
          let processName = "";
          if (rackProcessSelect && !rackProcessSelect.disabled && rackProcessSelect.value) processName = rackProcessSelect.value;
          else processName = processSelect.value;

          const statusName = statusSelect.options[statusSelect.selectedIndex]?.textContent || statusSelect.value;
          const note = (noteEl?.value || "").trim();

          if (!rackName || !processName || !statusName || processName === "ALL") {
            if (ptApplyHint) ptApplyHint.textContent = "Select rack, specific process and status first."; return;
          }

          const row = LIVE_ROWS.find(r =>
            String(normalizeRackBase(r)).toLowerCase() === String(rackName).toLowerCase() &&
            String(normalizeProcessName(r)).toLowerCase() === String(processName).toLowerCase()
          );

          if (!row || !row.rack_process_run_id) {
            if (ptApplyHint) ptApplyHint.textContent = `Error: Row not found for ${rackName} / ${processName}`; return;
          }

          const wantedLabel = String(statusName || "").trim().toUpperCase();
          const anyWithSameLabel = LIVE_ROWS.find(r => String(r.current_status || "").trim().toUpperCase() === wantedLabel);
          let statusId = anyWithSameLabel?.status_id ? Number(anyWithSameLabel.status_id) : null;

          if (!statusId) {
            const base = row.status_id ? Math.floor(Number(row.status_id) / 100) * 100 : 0;
            const code = normalizeStatusCodeFromLabel(wantedLabel);
            if (base && code) statusId = wantedLabel.includes("BLOCK") ? base + 99 : base + code;
          }

          if (!statusId) { if (ptApplyHint) ptApplyHint.textContent = "Error: Could not determine Status ID."; return; }

          if (ptApplyHint) ptApplyHint.textContent = "Saving...";
          applyBtn.disabled = true;

          await apiUpdateRunStatus(Number(row.rack_process_run_id), {
            status_id: statusId,
            responsible_employee_id: 999,
            note: note + (note ? ` (by ${who})` : `(by ${who})`),
          });

          if (ptApplyHint) ptApplyHint.textContent = "Saved ✅ Refreshing...";
          setTimeout(() => window.location.reload(), 500);

        } catch (e) {
          console.error(e);
          if (ptApplyHint) ptApplyHint.textContent = `Error: ${e.message || e}`;
        } finally {
          applyBtn.disabled = false;
        }
      });
    }

    applyFilters();
  });
})();