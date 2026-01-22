// frontend/js/progress.js
// Merged: Rich UI + real GET/POST to backend
// - GET:  /api/views/v_rack_process_status
// - POST: /api/runs/status   { rack_process_run_id, status_id, responsible_employee_id?, note? }

(function () {
  "use strict";

  // -------------------------
  // Small DOM helpers
  // -------------------------
  function qs(id) { return document.getElementById(id); }

  // --- API helpers (work with CloudFront: use relative /api/* by default) ---
  const PT = window.PT_API || {};
  const fetchJSON = PT.fetchJSON || (async (pathOrUrl, opts = {}) => {
    const cleanBase = (u) => String(u || "").trim().replace(/\/+$/, "");
    const base =
      (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL && cleanBase(window.APP_CONFIG.API_BASE_URL)) ||
      cleanBase(window.API_BASE) ||
      ""; // empty => same-origin (best for CloudFront)

    const url = String(pathOrUrl).startsWith("http") ? pathOrUrl : `${base}${pathOrUrl}`;

    const res = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });

    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }

    if (!res.ok) throw new Error(`API error ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    return body;
  });

  const getRackProcessStatus = PT.getRackProcessStatus || (() => fetchJSON("/api/views/v_rack_process_status"));

  // Status name -> status_id (generated from your SQL/appdata_fixed_v2.sql)
  const STATUS_ID_BY_PROCESS = {
    "1": {
      "NOT STARTED": 101,
      "IN PROCESS": 102,
      "ISSUE FOUND": 103,
      "REMEDIATION": 104,
      "PATCHING DONE": 105,
      "QC DONE": 106,
      "DONE": 107
    },
    "2": {
      "NOT STARTED": 201,
      "IN PROCESS": 202,
      "ISSUE FOUND": 203,
      "REMEDIATION": 204,
      "PATCHING DONE": 205,
      "QC DONE": 206,
      "DONE": 207
    },
    "3": {
      "NOT STARTED": 301,
      "IN PROCESS": 302,
      "QC DONE": 303,
      "DONE": 304
    },
    "4": {
      "NOT STARTED": 401,
      "IN PROCESS": 402,
      "QC DONE": 403,
      "DONE": 404
    },
    "5": {
      "NOT STARTED": 501,
      "IN PROCESS": 502,
      "QC DONE": 503,
      "DONE": 504
    }
  };

  function resolveStatusId(processId, statusName) {
    const pid = String(processId);
    const byPid = STATUS_ID_BY_PROCESS[pid];
    if (!byPid) return null;
    return byPid[statusName] || null;
  }

  // -------------------------
  // UI constants
  // -------------------------
  const RESPONSIBLES = [
    "Admin",
    "Operator",
    "Engineer",
    "QA"
  ];

  // UI state
  let STATE = {
    view: "process",       // process | rack
    dh: "DH12",
    zoom: 1,
    problemsOnly: false,
    qcOnly: false,
    search: "",
    sideSearch: "",
    selectedSU: null,
    selectedRackName: null,
    selectedRunId: null, // rack_process_run_id
    selectedProcessId: null,
    selectedProcessName: null
  };

  // Data from backend
  let RUNS = []; // from v_rack_process_status
  // Derived lookups
  const bySU = new Map();         // su -> runs
  const racksBySU = new Map();    // su -> Set(rack_name)
  const runsById = new Map();     // rack_process_run_id -> row

  // -------------------------
  // Toast helpers
  // -------------------------
  function toast(msg, type = "ok") {
    // if your CSS has no toast, fallback to console
    try {
      console.log(`[${type.toUpperCase()}] ${msg}`);
      const el = document.createElement("div");
      el.style.position = "fixed";
      el.style.right = "16px";
      el.style.bottom = "16px";
      el.style.padding = "10px 12px";
      el.style.borderRadius = "10px";
      el.style.zIndex = "9999";
      el.style.background = type === "err" ? "#b42318" : "#027a48";
      el.style.color = "#fff";
      el.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      el.style.fontSize = "14px";
      el.style.boxShadow = "0 10px 25px rgba(0,0,0,0.2)";
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2200);
    } catch (e) {
      // ignore
    }
  }

  // -------------------------
  // Build lookups
  // -------------------------
  function rebuildIndexes() {
    bySU.clear();
    racksBySU.clear();
    runsById.clear();

    for (const r of RUNS) {
      const su = String(r.SU || r.su || "").trim();
      if (!su) continue;

      if (!bySU.has(su)) bySU.set(su, []);
      bySU.get(su).push(r);

      if (!racksBySU.has(su)) racksBySU.set(su, new Set());
      if (r.rack_name) racksBySU.get(su).add(r.rack_name);

      if (r.rack_process_run_id != null) runsById.set(Number(r.rack_process_run_id), r);
    }

    // sort each SU list by rack_row + rack_name + process_id
    for (const [su, arr] of bySU.entries()) {
      arr.sort((a, b) => {
        const ar = Number(a.rack_row || 0), br = Number(b.rack_row || 0);
        if (ar !== br) return ar - br;
        const an = String(a.rack_name || ""), bn = String(b.rack_name || "");
        if (an !== bn) return an.localeCompare(bn);
        return Number(a.process_id || 0) - Number(b.process_id || 0);
      });
    }
  }

  // -------------------------
  // Filtering
  // -------------------------
  function isProblemRow(r) {
    const st = String(r.current_status || "").toUpperCase();
    return st.includes("ISSUE") || st.includes("REMEDIATION");
  }
  function isQcDoneRow(r) {
    const st = String(r.current_status || "").toUpperCase();
    return st.includes("QC DONE");
  }

  function matchesSearch(r, q) {
    if (!q) return true;
    const hay = [
      r.rack_id, r.rack_name, r.LU, r.SU, r.rack_type,
      r.process_name, r.current_status
    ].map(x => String(x || "").toUpperCase()).join(" ");
    return hay.includes(q.toUpperCase());
  }

  function filteredRunsForSU(su) {
    const base = bySU.get(su) || [];
    const q = (STATE.search || "").trim();
    return base.filter(r => {
      if (STATE.problemsOnly && !isProblemRow(r)) return false;
      if (STATE.qcOnly && !isQcDoneRow(r)) return false;
      if (!matchesSearch(r, q)) return false;
      return true;
    });
  }

  // -------------------------
  // Panel UI: Responsible modal
  // -------------------------
  function pickResponsible() {
    const modal = qs("ptRespModal");
    const sel = qs("ptRespSelect");
    const ok = qs("ptRespOk");
    const cancel = qs("ptRespCancel");

    if (!modal || !sel || !ok || !cancel) {
      const who = window.prompt("Who is responsible for this status change?\n" + RESPONSIBLES.join("\n"), "Admin");
      return Promise.resolve((who || "").trim() || null);
    }

    // fill select if empty
    if (!sel.options.length) {
      for (const name of RESPONSIBLES) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      }
    }

    return new Promise((resolve) => {
      modal.classList.add("open");

      function close(val) {
        modal.classList.remove("open");
        ok.removeEventListener("click", onOk);
        cancel.removeEventListener("click", onCancel);
        modal.removeEventListener("click", onBackdrop);
        resolve(val);
      }
      function onOk() { close(sel.value || null); }
      function onCancel() { close(null); }
      function onBackdrop(e) {
        if (e.target === modal) close(null);
      }

      ok.addEventListener("click", onOk);
      cancel.addEventListener("click", onCancel);
      modal.addEventListener("click", onBackdrop);
    });
  }

  // map responsible name -> numeric id for backend (optional)
  // if your DB uses employees, set a real mapping here.
  function responsibleToEmployeeId(name) {
    // For demo: keep 999 for "unknown/system" unless you want a mapping
    return 999;
  }

  // -------------------------
  // Render / Update sidebar panel
  // -------------------------
  function setPanelSelected(row) {
    const title = document.querySelector(".selected-title");
    const sub = document.querySelector(".selected-sub");

    if (!title || !sub) return;

    if (!row) {
      title.textContent = "—";
      sub.textContent = "";
      return;
    }

    title.textContent = `${row.rack_name || "—"} / ${row.process_name || "—"}`;
    sub.textContent = `Current: ${row.current_status || "—"} | SU: ${row.SU || "—"} | LU: ${row.LU || "—"}`;
  }

  function enableForm(enabled) {
    const ids = ["ptRack", "ptRackProcess", "ptStatus", "ptNote", "ptApplyStatus"];
    for (const id of ids) {
      const el = qs(id);
      if (el) el.disabled = !enabled;
    }
  }

  // Build rack select for selected SU
  function fillRackSelectForSU(su) {
    const rackSel = qs("ptRack");
    if (!rackSel) return;

    rackSel.innerHTML = "";
    const racks = Array.from(racksBySU.get(su) || []).sort((a, b) => a.localeCompare(b));
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = racks.length ? "Select rack…" : "No racks";
    rackSel.appendChild(opt0);

    for (const r of racks) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      rackSel.appendChild(opt);
    }

    rackSel.disabled = !racks.length;
  }

  // Fill process select for SU+rack
  function fillProcessSelectForRack(su, rackName) {
    const procSel = qs("ptRackProcess");
    if (!procSel) return;

    procSel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Select process…";
    procSel.appendChild(opt0);

    const rows = (bySU.get(su) || []).filter(r => String(r.rack_name) === String(rackName));
    const uniq = new Map(); // process_id -> name
    for (const r of rows) {
      if (r.process_id && r.process_name) uniq.set(Number(r.process_id), r.process_name);
    }
    const entries = Array.from(uniq.entries()).sort((a, b) => a[0] - b[0]);

    for (const [pid, pname] of entries) {
      const opt = document.createElement("option");
      opt.value = String(pid);
      opt.textContent = pname;
      procSel.appendChild(opt);
    }

    procSel.disabled = entries.length === 0;
  }

  function fillStatusSelectForProcess(processId) {
    const statusSel = qs("ptStatus");
    if (!statusSel) return;

    statusSel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Select status…";
    statusSel.appendChild(opt0);

    const pid = String(processId);
    const byPid = STATUS_ID_BY_PROCESS[pid];
    if (!byPid) {
      statusSel.disabled = true;
      return;
    }

    // order by numeric id
    const entries = Object.entries(byPid)
      .map(([name, id]) => ({ name, id }))
      .sort((a, b) => a.id - b.id);

    for (const s of entries) {
      const opt = document.createElement("option");
      opt.value = s.name; // UI uses name, we resolve to id on submit
      opt.textContent = s.name;
      statusSel.appendChild(opt);
    }

    statusSel.disabled = false;
  }

  // -------------------------
  // Bars (summary)
  // -------------------------
  function calcSummary(rows) {
    // Basic rule: determine Not started / In progress / QC done
    let notStarted = 0, inProgress = 0, qcDone = 0;
    for (const r of rows) {
      const st = String(r.current_status || "").toUpperCase();
      if (st.includes("NOT STARTED")) notStarted++;
      else if (st.includes("QC DONE")) qcDone++;
      else inProgress++;
    }
    const total = rows.length || 1;
    return {
      notStarted, inProgress, qcDone,
      pNotStarted: Math.round((notStarted / total) * 100),
      pInProgress: Math.round((inProgress / total) * 100),
      pQCDone: Math.round((qcDone / total) * 100),
    };
  }

  function setBars(sum) {
    const barNS = qs("barNotStarted");
    const barIP = qs("barInProgress");
    const barQC = qs("barQCDone");
    const pctNS = qs("pctNotStarted");
    const pctIP = qs("pctInProgress");
    const pctQC = qs("pctQCDone");

    if (barNS) barNS.style.width = `${sum.pNotStarted}%`;
    if (barIP) barIP.style.width = `${sum.pInProgress}%`;
    if (barQC) barQC.style.width = `${sum.pQCDone}%`;

    if (pctNS) pctNS.textContent = `${sum.pNotStarted}%`;
    if (pctIP) pctIP.textContent = `${sum.pInProgress}%`;
    if (pctQC) pctQC.textContent = `${sum.pQCDone}%`;
  }

  // -------------------------
  // Matrix coloring helpers
  // -------------------------
  function statusToClass(status) {
    const s = String(status || "").toUpperCase();
    if (s.includes("NOT STARTED")) return "st-notstarted";
    if (s.includes("ISSUE")) return "st-issue";
    if (s.includes("REMEDIATION")) return "st-remediation";
    if (s.includes("PATCHING DONE")) return "st-patching";
    if (s.includes("QC DONE")) return "st-qcdone";
    if (s === "DONE") return "st-done";
    if (s.includes("IN PROCESS")) return "st-inprocess";
    return "st-unknown";
  }

  function paintMatrixForSU(su) {
    // This UI uses spans with data-su attributes.
    // We'll paint those spans based on worst status across runs in that SU.
    const root = qs("matrixRoot");
    if (!root) return;

    // reset all
    const spans = root.querySelectorAll("span.su[data-su]");
    spans.forEach(sp => {
      sp.classList.remove(
        "st-notstarted", "st-inprocess", "st-issue", "st-remediation",
        "st-patching", "st-qcdone", "st-done", "st-unknown"
      );
      sp.title = "";
    });

    const rows = filteredRunsForSU(su);

    // group by rack_name
    const byRack = new Map();
    for (const r of rows) {
      const key = String(r.rack_name || r.rack_id || "");
      if (!key) continue;
      if (!byRack.has(key)) byRack.set(key, []);
      byRack.get(key).push(r);
    }

    // paint spans by matching the SU number if possible
    // If your HTML uses data-su numeric values, you can map it better.
    for (const sp of spans) {
      // we won't do heavy mapping here (keeps your existing UI logic)
      // leaving spans as-is if no direct mapping.
    }

    // Update side bars summary
    setBars(calcSummary(rows));
  }

  // -------------------------
  // Main reload + render
  // -------------------------
  async function reloadRunsAndRender() {
    const data = await getRackProcessStatus();
    RUNS = Array.isArray(data) ? data : [];
    rebuildIndexes();

    const dhSel = qs("dhSelect");
    if (dhSel) {
      // If you have more DHs, fill later. Keep existing default.
      dhSel.value = STATE.dh || dhSel.value;
    }

    // default SU selection (use first in data)
    if (!STATE.selectedSU) {
      const firstSU = RUNS.length ? String(RUNS[0].SU || "") : null;
      STATE.selectedSU = firstSU || "SU01";
    }

    // Refill panel selects for current SU
    fillRackSelectForSU(STATE.selectedSU);

    // Render matrix for SU
    paintMatrixForSU(STATE.selectedSU);

    // If something selected, refresh panel display
    const selected = STATE.selectedRunId ? runsById.get(Number(STATE.selectedRunId)) : null;
    setPanelSelected(selected);
  }

  // -------------------------
  // Initialize listeners
  // -------------------------
  function init() {
    // Tabs
    const seg = qs("viewSeg");
    if (seg) {
      seg.addEventListener("click", (e) => {
        const btn = e.target.closest("button.tab");
        if (!btn) return;
        const view = btn.dataset.view;
        if (!view) return;
        STATE.view = view;
        seg.querySelectorAll("button.tab").forEach(b => b.classList.toggle("active", b === btn));
        // (UI view toggle can be expanded later)
        paintMatrixForSU(STATE.selectedSU);
      });
    }

    // Search (top)
    const search = qs("ptSearch");
    if (search) {
      search.addEventListener("input", () => {
        STATE.search = search.value || "";
        paintMatrixForSU(STATE.selectedSU);
      });
    }

    // Problems/QC toggles
    const problemsOnly = qs("problemsOnly");
    if (problemsOnly) {
      problemsOnly.addEventListener("change", () => {
        STATE.problemsOnly = !!problemsOnly.checked;
        paintMatrixForSU(STATE.selectedSU);
      });
    }
    const qcOnly = qs("qcOnly");
    if (qcOnly) {
      qcOnly.addEventListener("change", () => {
        STATE.qcOnly = !!qcOnly.checked;
        paintMatrixForSU(STATE.selectedSU);
      });
    }

    // Rack select
    const rackSel = qs("ptRack");
    if (rackSel) {
      rackSel.addEventListener("change", () => {
        const rack = rackSel.value || "";
        STATE.selectedRackName = rack || null;
        STATE.selectedProcessId = null;
        STATE.selectedRunId = null;

        if (!rack) {
          const procSel = qs("ptRackProcess");
          if (procSel) {
            procSel.innerHTML = "";
            procSel.disabled = true;
          }
          enableForm(false);
          setPanelSelected(null);
          return;
        }

        fillProcessSelectForRack(STATE.selectedSU, rack);
        enableForm(false);
        setPanelSelected(null);
      });
    }

    // Process select
    const procSel = qs("ptRackProcess");
    if (procSel) {
      procSel.addEventListener("change", () => {
        const pid = procSel.value || "";
        STATE.selectedProcessId = pid ? Number(pid) : null;

        const statusSel = qs("ptStatus");
        const note = qs("ptNote");
        const applyBtn = qs("ptApplyStatus");

        if (!STATE.selectedRackName || !STATE.selectedProcessId) {
          if (statusSel) statusSel.disabled = true;
          if (note) note.disabled = true;
          if (applyBtn) applyBtn.disabled = true;
          STATE.selectedRunId = null;
          setPanelSelected(null);
          return;
        }

        // Find run row for SU + rack + process
        const row = (bySU.get(STATE.selectedSU) || []).find(r =>
          String(r.rack_name) === String(STATE.selectedRackName) &&
          Number(r.process_id) === Number(STATE.selectedProcessId)
        );

        if (!row) {
          toast("No run row found for that rack/process", "err");
          STATE.selectedRunId = null;
          setPanelSelected(null);
          enableForm(false);
          return;
        }

        STATE.selectedRunId = Number(row.rack_process_run_id);
        STATE.selectedProcessName = row.process_name || null;

        fillStatusSelectForProcess(STATE.selectedProcessId);
        enableForm(true);
        setPanelSelected(row);
      });
    }

    // Clear selection
    const clearSel = qs("ptClearSel");
    if (clearSel) {
      clearSel.addEventListener("click", () => {
        STATE.selectedRackName = null;
        STATE.selectedProcessId = null;
        STATE.selectedRunId = null;

        const rackSel = qs("ptRack");
        if (rackSel) rackSel.value = "";
        const procSel = qs("ptRackProcess");
        if (procSel) {
          procSel.innerHTML = "";
          procSel.disabled = true;
        }
        const statusSel = qs("ptStatus");
        if (statusSel) {
          statusSel.innerHTML = "";
          statusSel.disabled = true;
        }
        const note = qs("ptNote");
        if (note) note.value = "";
        enableForm(false);
        setPanelSelected(null);
      });
    }

    // Apply status (POST)
    const applyBtn = qs("ptApplyStatus");
    if (applyBtn) {
      applyBtn.addEventListener("click", async () => {
        try {
          if (!STATE.selectedRunId || !STATE.selectedProcessId || !STATE.selectedRackName) {
            toast("Select rack + process first", "err");
            return;
          }

          const statusSel = qs("ptStatus");
          const noteEl = qs("ptNote");
          const statusName = statusSel ? (statusSel.value || "") : "";
          const noteText = noteEl ? (noteEl.value || "") : "";

          if (!statusName) {
            toast("Select a status", "err");
            return;
          }

          // row currently selected
          const selected = runsById.get(Number(STATE.selectedRunId));
          if (!selected) {
            toast("Selected run not found", "err");
            return;
          }

          // responsible
          const who = await pickResponsible();
          if (!who) {
            toast("Cancelled", "err");
            return;
          }
          const empId = responsibleToEmployeeId(who);

          // Resolve status_id from process_id + status name
          const statusId = resolveStatusId(selected.process_id, statusName);
          if (!statusId) {
            toast(`Unknown status_id for "${statusName}" (process ${selected.process_id})`, "err");
            return;
          }

          // POST update
          await fetchJSON("/api/runs/status", {
            method: "POST",
            body: JSON.stringify({
              rack_process_run_id: selected.rack_process_run_id,
              status_id: statusId,
              responsible_employee_id: empId,
              note: noteText || null
            })
          });

          toast("Status updated ✅", "ok");

          // reload from server so refresh won't revert
          await reloadRunsAndRender();

          // keep selection visible
          const refreshed = runsById.get(Number(STATE.selectedRunId));
          setPanelSelected(refreshed || null);

        } catch (e) {
          console.error(e);
          toast(e.message || "Update failed", "err");
        }
      });
    }

    // Initial load
    reloadRunsAndRender().catch((e) => {
      console.error(e);
      toast("Failed to load data: " + (e.message || e), "err");
    });
  }

  // Run
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
