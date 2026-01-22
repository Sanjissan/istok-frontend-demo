(function () {
  const T_A_1_7 = {
    1: "NOT STARTED",
    2: "DRESSING IN PROGRESS",
    3: "DRESSING DONE",
    4: "PATCHING IN PROGRESS",
    5: "PATCHING DONE",
    6: "QC DONE",
    7: "BLOCKED",
  };

  const T_B_1_5 = {
    1: "NOT STARTED",
    2: "IN PROGRESS",
    3: "DONE",
    4: "QC DONE",
    5: "BLOCKED",
  };

  const PROCESS_TEMPLATES = {
    // long names from DB (process_name)
    "ROCE T1: AS-T1/R.T1-T2": T_A_1_7,
    "ROCE T2: R.T1-T2": T_A_1_7,
    "R.T2-T3": T_A_1_7,
    "SIS T1: AS-T1": T_A_1_7,
    "SIS T1-T2": T_A_1_7,

    "SU-MS IPMI": T_B_1_5,
    "IPMI JUMPERS LC-LC": T_B_1_5,
    "MS-MC T1 144F": T_B_1_5,
    "MS-MC NA15/NB15": T_B_1_5,
    "MC-MF NM09-NL09": T_B_1_5,
    "GPU CAT6": T_B_1_5,
    "IPMI CAT6": T_B_1_5,
    "GPU AEC": T_B_1_5,
  };

  const RESPONSIBLES = ["Admin", "Tech1", "Tech2", "QC", "Manager"];

  // -----------------------------
  // API helpers (work in CloudFront)
  // -----------------------------
  const STORAGE_KEY = "pt_api_base_url";

  function cleanBase(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function resolveBase() {
    // If empty -> use relative URLs (best for CloudFront with /api/* behavior)
    const cfg = window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL;
    if (cfg !== undefined && cfg !== null) return cleanBase(cfg);
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    if (fromStorage) return cleanBase(fromStorage);
    return ""; // default relative
  }

  async function fetchJSON(pathOrUrl, opts = {}) {
    const base = resolveBase();
    const url = /^https?:\/\//i.test(pathOrUrl)
      ? pathOrUrl
      : base
      ? `${base}${pathOrUrl}`
      : pathOrUrl;

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

  async function apiGetRackProcessStatus() {
    // prefer PT_API if it exists (backward compatible), otherwise call directly
    if (window.PT_API && typeof window.PT_API.getRackProcessStatus === "function") {
      return window.PT_API.getRackProcessStatus();
    }
    return fetchJSON("/api/views/v_rack_process_status");
  }

  async function apiUpdateRunStatus(
    rack_process_run_id,
    { status_id, responsible_employee_id, note } = {}
  ) {
    return fetchJSON("/api/runs/status", {
      method: "POST",
      body: JSON.stringify({
        rack_process_run_id,
        status_id,
        responsible_employee_id,
        note,
      }),
    });
  }

  // -----------------------------
  // Internal state
  // -----------------------------
  // This keeps the UI "code" (1..7 etc) for each rack+process in memory
  // key: `${rackName}|${processName}` => code
  const PROGRESS = new Map();

  // cache of backend rows (view)
  let LIVE_ROWS = [];

  // -----------------------------
  // Utility helpers
  // -----------------------------
  function statusToCode(template, label) {
    if (!template) return 1;
    const x = String(label || "").trim().toUpperCase();

    for (const [k, v] of Object.entries(template)) {
      if (String(v).trim().toUpperCase() === x) return Number(k);
    }

    // fallback
    if (x.includes("NOT START")) return 1;
    if (x.includes("QC DONE") || x === "DONE") return 6;
    if (x.includes("BLOCK")) return 7;

    return 1;
  }

  function normalizeStatusCodeFromLabel(labelUpper) {
    const label = String(labelUpper || "").trim().toUpperCase();
    if (!label) return null;

    // try to find label in any known template
    for (const tpl of Object.values(PROCESS_TEMPLATES)) {
      for (let i = 1; i <= 7; i++) {
        const v = (tpl?.[i] || "").toString().trim().toUpperCase();
        if (v && v === label) return i;
      }
    }

    // small fallback (if label is free-form)
    if (label.includes("NOT START")) return 1;
    if (label.includes("QC DONE") || label === "DONE") return 6;
    if (label.includes("BLOCK")) return 7;

    return null;
  }

  function keyOf(rackName, processName) {
    return `${String(rackName).trim()}|${String(processName).trim()}`;
  }

  function getSelectedText(selectEl) {
    if (!selectEl) return "";
    const opt = selectEl.options?.[selectEl.selectedIndex];
    return (opt?.textContent || "").trim();
  }

  function setVisible(el, v) {
    if (!el) return;
    el.hidden = !v;
    el.style.display = v ? "" : "none";
  }

  function safeEl(id) {
    return document.getElementById(id);
  }

  // -----------------------------
  // Backend -> PROGRESS sync
  // -----------------------------
  async function syncProgressFromBackend() {
    const rows = await apiGetRackProcessStatus();
    LIVE_ROWS = Array.isArray(rows) ? rows : [];

    PROGRESS.clear();

    for (const r of LIVE_ROWS) {
      const rackName = (r.rack_name || "").trim();
      const processName = (r.process_name || "").trim();
      const statusLabel = (r.current_status || "").trim();

      const tpl = PROCESS_TEMPLATES[processName];
      const code = statusToCode(tpl, statusLabel);

      PROGRESS.set(keyOf(rackName, processName), code);
    }
  }

  async function getLiveRowsSafe() {
    if (!Array.isArray(LIVE_ROWS) || LIVE_ROWS.length === 0) {
      await syncProgressFromBackend();
    }
    return LIVE_ROWS;
  }

  // -----------------------------
  // UI rendering logic
  // -----------------------------
  function applyStatusClasses(el, code) {
    // you can tune classes to match your CSS
    el.classList.remove(
      "st-1",
      "st-2",
      "st-3",
      "st-4",
      "st-5",
      "st-6",
      "st-7"
    );
    el.classList.add(`st-${code || 1}`);
  }

  function renderMatrix() {
    // This file assumes your HTML already contains the matrix
    // We only paint statuses onto `.su` elements based on their text (rack name)
    const suNodes = document.querySelectorAll(".su");
    if (!suNodes?.length) return;

    // Example: on process view, we color each rack by selected process
    const procSel = safeEl("ptProcess");
    const currentProcess = getSelectedText(procSel);

    for (const node of suNodes) {
      const rackName = (node.textContent || "").trim();
      if (!rackName) continue;

      // if no process selected yet, default to first template key
      const proc =
        currentProcess && PROCESS_TEMPLATES[currentProcess]
          ? currentProcess
          : Object.keys(PROCESS_TEMPLATES)[0];

      const code = PROGRESS.get(keyOf(rackName, proc)) || 1;
      applyStatusClasses(node, code);
    }
  }

  function fillProcessDropdown() {
    const procSel = safeEl("ptProcess");
    const chips = safeEl("ptProcessChips");
    if (!procSel) return;

    const names = Object.keys(PROCESS_TEMPLATES);

    procSel.innerHTML = "";
    for (const name of names) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      procSel.appendChild(opt);
    }

    // chips (optional)
    if (chips) {
      chips.innerHTML = "";
      const all = document.createElement("button");
      all.type = "button";
      all.className = "chip";
      all.textContent = "All";
      all.dataset.process = "";
      chips.appendChild(all);

      for (const name of names) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = name;
        b.dataset.process = name;
        chips.appendChild(b);
      }

      chips.addEventListener("click", (e) => {
        const btn = e.target?.closest?.("button");
        if (!btn) return;
        const p = btn.dataset.process || "";
        if (p) procSel.value = p;
        renderMatrix();
      });
    }
  }

  function fillRackDropdown(rows) {
    const rackSel = safeEl("ptRack");
    if (!rackSel) return;

    const unique = new Set();
    for (const r of rows) unique.add(String(r.rack_name || "").trim());
    const list = Array.from(unique).sort((a, b) => a.localeCompare(b));

    rackSel.innerHTML = "";
    for (const name of list) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      rackSel.appendChild(opt);
    }
  }

  function fillRackProcessDropdown(rows) {
    const procSel = safeEl("ptRackProcess");
    if (!procSel) return;

    const unique = new Set();
    for (const r of rows) unique.add(String(r.process_name || "").trim());
    const list = Array.from(unique).sort((a, b) => a.localeCompare(b));

    procSel.innerHTML = "";
    for (const name of list) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      procSel.appendChild(opt);
    }
  }

  function fillStatusDropdown(processName) {
    const statusSel = safeEl("ptStatus");
    if (!statusSel) return;

    const tpl = PROCESS_TEMPLATES[processName];
    statusSel.innerHTML = "";

    if (!tpl) {
      const opt = document.createElement("option");
      opt.value = "NOT STARTED";
      opt.textContent = "NOT STARTED";
      statusSel.appendChild(opt);
      return;
    }

    const max = Object.keys(tpl).length;
    for (let i = 1; i <= max; i++) {
      const label = tpl[i];
      if (!label) continue;
      const opt = document.createElement("option");
      opt.value = label;
      opt.textContent = label;
      statusSel.appendChild(opt);
    }
  }

  // -----------------------------
  // Responsible modal/prompt
  // -----------------------------
  function pickResponsible() {
    const modal = safeEl("ptRespModal");
    const sel = safeEl("ptRespSelect");
    const ok = safeEl("ptRespOk");
    const cancel = safeEl("ptRespCancel");

    if (!modal || !sel || !ok || !cancel) {
      const who = window.prompt(
        "Who is responsible for this status change?\n" + RESPONSIBLES.join("\n"),
        "Admin"
      );
      return Promise.resolve((who || "").trim() || null);
    }

    sel.innerHTML = "";
    for (const r of RESPONSIBLES) {
      const o = document.createElement("option");
      o.value = r;
      o.textContent = r;
      sel.appendChild(o);
    }

    return new Promise((resolve) => {
      modal.classList.add("open");

      const cleanup = () => {
        modal.classList.remove("open");
        ok.onclick = null;
        cancel.onclick = null;
      };

      ok.onclick = () => {
        const who = (sel.value || "").trim();
        cleanup();
        resolve(who || null);
      };

      cancel.onclick = () => {
        cleanup();
        resolve(null);
      };
    });
  }

  // -----------------------------
  // Main init
  // -----------------------------
  async function init() {
    // 1) sync backend state
    await syncProgressFromBackend();

    // 2) setup dropdowns & render
    fillProcessDropdown();
    const rows = await getLiveRowsSafe();
    fillRackDropdown(rows);
    fillRackProcessDropdown(rows);

    const procSel = safeEl("ptRackProcess");
    const statusSel = safeEl("ptStatus");
    if (procSel) {
      fillStatusDropdown(getSelectedText(procSel));
      procSel.addEventListener("change", () => {
        fillStatusDropdown(getSelectedText(procSel));
      });
    }

    renderMatrix();

    // 3) Apply Status button -> SAVE TO DB
    const applyBtn = safeEl("ptApplyStatus");
    const rackSel = safeEl("ptRack");
    const noteEl = safeEl("ptNote");
    const ptApplyHint = safeEl("ptApplyHint");

    if (applyBtn && rackSel && procSel && statusSel && ptApplyHint) {
      applyBtn.disabled = false;
      rackSel.disabled = false;
      procSel.disabled = false;
      statusSel.disabled = false;
      if (noteEl) noteEl.disabled = false;

      applyBtn.addEventListener("click", async () => {
        try {
          // 1) who is responsible
          const who = await pickResponsible();
          if (!who) {
            ptApplyHint.textContent = "Responsible is required.";
            return;
          }

          // 2) selected values from UI
          const rackName = getSelectedText(rackSel); // e.g. "LAC"
          const processName = getSelectedText(procSel); // e.g. "ROCE T1: AS-T1/R.T1-T2"
          const statusName = getSelectedText(statusSel); // e.g. "PATCHING DONE"
          const note = (noteEl?.value || "").trim();

          if (!rackName || !processName || !statusName) {
            ptApplyHint.textContent = "Select rack, process and status first.";
            return;
          }

          // 3) map to DB row (run id + status_id)
          const rows = await getLiveRowsSafe();

          const row = rows.find(
            (r) =>
              String(r.rack_name).trim() === rackName &&
              String(r.process_name).trim() === processName
          );

          if (!row || !row.rack_process_run_id) {
            ptApplyHint.textContent = `Can't map selection to DB row. rack="${rackName}", process="${processName}"`;
            return;
          }

          // 4) determine status_id:
          //    - If DB already contains this status name somewhere, use that id.
          //    - Else: infer base from current process (e.g. 105 -> base 100) and add our internal code.
          const wantedLabel = String(statusName || "").trim().toUpperCase();

          const anyWithSameLabel = rows.find(
            (r) =>
              String(r.current_status || "").trim().toUpperCase() === wantedLabel
          );
          let statusId = anyWithSameLabel?.status_id
            ? Number(anyWithSameLabel.status_id)
            : null;

          if (!statusId) {
            // infer base from this process, e.g. 105 -> 100
            const sample = rows.find(
              (r) =>
                String(r.process_name).trim() === processName && r.status_id
            );
            const base = sample?.status_id
              ? Math.floor(Number(sample.status_id) / 100) * 100
              : 0;

            // translate label -> internal numeric code (1..7) using the same templates
            const code = normalizeStatusCodeFromLabel(wantedLabel);
            if (!base || !code) {
              ptApplyHint.textContent = `Can't map status to status_id. status="${statusName}" (base=${base}, code=${code})`;
              return;
            }

            // Special case: BLOCKED often uses 199 / 299 etc. If your DB uses something else, change here.
            statusId = wantedLabel.includes("BLOCK") ? base + 99 : base + code;
          }

          ptApplyHint.textContent = "Saving...";
          applyBtn.disabled = true;

          // NOTE: no employee-id mapping yet, so send 999 (your backend default) unless you change it.
          await apiUpdateRunStatus(Number(row.rack_process_run_id), {
            status_id: statusId,
            responsible_employee_id: 999,
            note,
          });

          ptApplyHint.textContent = "Saved ✅ Refreshing...";
          setTimeout(() => window.location.reload(), 300);
        } catch (e) {
          console.error(e);
          ptApplyHint.textContent = `Error: ${e.message || e}`;
        } finally {
          applyBtn.disabled = false;
        }
      });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => console.error("init failed:", e));
  });
})();
