// frontend/js/progress.js
// Works with:
// - GET  /api/runs                     -> returns rows from v_rack_process_status
// - POST /api/runs/status              -> { rack_process_run_id, status_id, responsible_employee_id?, note? }
//
// Requires HTML elements (ids):
// ptProcessChips, problemsOnly, qcOnly, ptNote, ptApplyStatus,
// ptRespModal, ptRespSelect, ptRespOk, ptRespCancel,
// ptPanelTitle, ptPanelSub, ptClearSel, ptRack, ptRackHint, ptStatus, ptStatusHint, ptApplyHint,
// zoomIn, zoomOut, zoomReset, zoomPct, matrixZoom, mapScroll, ptSearch, ptSideSearch

(function () {
  "use strict";

  // -----------------------------
  // Small helpers
  // -----------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function normStr(s) {
    return String(s ?? "").trim();
  }

  function parseSUToNumber(su) {
    // "SU01" -> 1, "SU1" -> 1,  "1" -> 1
    const t = normStr(su).toUpperCase();
    const m = t.match(/(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function safeUpper(s) {
    return normStr(s).toUpperCase();
  }

  function statusBucket(statusName) {
    const s = safeUpper(statusName);

    // tweak mapping for your real statuses
    if (s.includes("NOT START")) return "not_started";
    if (s.includes("QC DONE") || s.includes("QC") || s.includes("QUALITY")) return "qc_done";
    if (s.includes("IN PROGRESS") || s.includes("START") || s.includes("PATCH")) return "in_progress";
    if (s === "DONE" || (s.includes("DONE") && !s.includes("NOT"))) return "done";

    // fallback
    return "unknown";
  }

  function isProblemRow(row) {
    const s = safeUpper(row.current_status);
    const run = safeUpper(row.run_state);
    return (
      s.includes("BLOCK") ||
      s.includes("HOLD") ||
      s.includes("FAIL") ||
      s.includes("ERROR") ||
      run.includes("BLOCK")
    );
  }

  function looksLikeQC(row) {
    const s = safeUpper(row.current_status);
    return s.includes("QC");
  }

  // -----------------------------
  // API wrapper
  // -----------------------------
  async function fetchJSON(path, opts = {}) {
    // If you use api.js which exposes window.PT_API.fetchJSON, use it.
    if (window.PT_API && typeof window.PT_API.fetchJSON === "function") {
      return window.PT_API.fetchJSON(path, opts);
    }

    // Fallback: relative fetch (CloudFront + /api/* behavior)
    const res = await fetch(path, {
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
      throw new Error(`API error ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    }
    return body;
  }

  async function apiGetRuns(limit = 1000) {
    // You created: GET /api/runs?limit=...
    return fetchJSON(`/api/runs?limit=${encodeURIComponent(limit)}`);
  }

  async function apiUpdateStatus({ rack_process_run_id, status_id, responsible_employee_id, note }) {
    return fetchJSON(`/api/runs/status`, {
      method: "POST",
      body: JSON.stringify({ rack_process_run_id, status_id, responsible_employee_id, note }),
    });
  }

  // -----------------------------
  // UI state
  // -----------------------------
  const state = {
    runs: [],
    selectedProcessId: null,
    selectedProcessName: "",
    problemsOnly: false,
    qcOnly: false,

    // selection
    selectedSU: null,                 // number (1..96)
    selectedRackProcessRunId: null,   // from API
    selectedStatusId: null,           // chosen from dropdown
  };

  // -----------------------------
  // DOM refs (may be null if HTML differs)
  // -----------------------------
  const els = {
    processChips: $("#ptProcessChips"),
    problemsOnly: $("#problemsOnly"),
    qcOnly: $("#qcOnly"),

    ptPanelTitle: $("#ptPanelTitle"),
    ptPanelSub: $("#ptPanelSub"),

    ptClearSel: $("#ptClearSel"),
    ptRack: $("#ptRack"),
    ptRackHint: $("#ptRackHint"),
    ptStatus: $("#ptStatus"),
    ptStatusHint: $("#ptStatusHint"),
    ptNote: $("#ptNote"),
    ptApplyStatus: $("#ptApplyStatus"),
    ptApplyHint: $("#ptApplyHint"),

    // Responsible modal
    respModal: $("#ptRespModal"),
    respSelect: $("#ptRespSelect"),
    respOk: $("#ptRespOk"),
    respCancel: $("#ptRespCancel"),

    // Search
    ptSearch: $("#ptSearch"),
    ptSideSearch: $("#ptSideSearch"),
  };

  // -----------------------------
  // Styling for SU nodes
  // (You can map to your CSS classes if you already have them)
  // -----------------------------
  function clearAllSUClasses() {
    $$(".su").forEach((node) => {
      node.classList.remove(
        "pt-ns", "pt-ip", "pt-qc", "pt-done", "pt-unk",
        "pt-problem", "pt-selected"
      );
      node.removeAttribute("title");
    });
  }

  function applySUClass(node, bucket) {
    // If your CSS already has these classes -> great.
    // If not, add them in style.css later.
    if (bucket === "not_started") node.classList.add("pt-ns");
    else if (bucket === "in_progress") node.classList.add("pt-ip");
    else if (bucket === "qc_done") node.classList.add("pt-qc");
    else if (bucket === "done") node.classList.add("pt-done");
    else node.classList.add("pt-unk");
  }

  // -----------------------------
  // Render processes as chips
  // -----------------------------
  function buildProcessList() {
    const m = new Map(); // process_id -> name
    for (const r of state.runs) {
      if (r.process_id != null) {
        m.set(Number(r.process_id), normStr(r.process_name || `Process ${r.process_id}`));
      }
    }
    const list = Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.id - b.id);

    return list;
  }

  function renderProcessChips() {
    if (!els.processChips) return;

    const list = buildProcessList();
    els.processChips.innerHTML = "";

    list.forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (p.id === state.selectedProcessId ? " active" : "");
      btn.textContent = p.name;
      btn.addEventListener("click", () => {
        state.selectedProcessId = p.id;
        state.selectedProcessName = p.name;
        state.selectedSU = null;
        state.selectedRackProcessRunId = null;
        state.selectedStatusId = null;
        renderAll();
      });
      els.processChips.appendChild(btn);
    });

    // default pick first process if none
    if (state.selectedProcessId == null && list.length > 0) {
      state.selectedProcessId = list[0].id;
      state.selectedProcessName = list[0].name;
      renderAll();
    }
  }

  // -----------------------------
  // Build "effective" runs for current filter
  // -----------------------------
  function getFilteredRunsForSelectedProcess() {
    const pid = state.selectedProcessId;
    if (!pid) return [];

    let rows = state.runs.filter((r) => Number(r.process_id) === Number(pid));

    if (state.problemsOnly) {
      rows = rows.filter(isProblemRow);
    }
    if (state.qcOnly) {
      rows = rows.filter(looksLikeQC);
    }

    // optional search (top bar)
    const q = normStr(els.ptSearch?.value).toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const rack = normStr(r.rack_name).toLowerCase();
        const rackId = normStr(r.rack_id).toLowerCase();
        const su = normStr(r.SU).toLowerCase();
        const lu = normStr(r.LU).toLowerCase();
        return rack.includes(q) || rackId.includes(q) || su.includes(q) || lu.includes(q);
      });
    }

    return rows;
  }

  // -----------------------------
  // Paint the matrix (SU elements)
  // -----------------------------
  function renderMatrix() {
    clearAllSUClasses();

    const rows = getFilteredRunsForSelectedProcess();
    const bySU = new Map(); // suNumber -> representative row

    // If multiple rows per SU (unlikely), pick the "most important":
    // - problems win
    // - else latest status (not possible without timestamp), so just keep first
    for (const r of rows) {
      const suNum = parseSUToNumber(r.SU);
      if (!suNum) continue;

      const prev = bySU.get(suNum);
      if (!prev) {
        bySU.set(suNum, r);
      } else {
        // keep problem if any
        if (!isProblemRow(prev) && isProblemRow(r)) bySU.set(suNum, r);
      }
    }

    // Update all su nodes with matching data-su
    for (const node of $$(".su")) {
      const key = node.getAttribute("data-su");
      if (!key) continue;

      // Many nodes have data-su like "96" etc. Some have string keys (LU1_ROW13_SIS_T1)
      // We only paint numeric SUs.
      const n = Number(key);
      if (!Number.isFinite(n)) continue;

      const row = bySU.get(n);
      if (!row) continue;

      const bucket = statusBucket(row.current_status);
      applySUClass(node, bucket);

      if (isProblemRow(row)) node.classList.add("pt-problem");

      // tooltip
      const tip = [
        `${row.rack_name || row.rack_id || ""}`.trim(),
        `SU: ${row.SU || n}`,
        `Process: ${row.process_name || state.selectedProcessName}`,
        `Status: ${row.current_status || "—"}`,
      ].filter(Boolean).join("\n");
      node.title = tip;

      // selection marker
      if (state.selectedSU && n === state.selectedSU) {
        node.classList.add("pt-selected");
      }
    }
  }

  // -----------------------------
  // Sidebar: selection + status dropdown
  // -----------------------------
  function renderSidebar() {
    const rows = getFilteredRunsForSelectedProcess();

    // Panel title
    if (els.ptPanelTitle) {
      els.ptPanelTitle.textContent = state.selectedProcessName ? state.selectedProcessName : "—";
    }

    // Clear selection
    if (els.ptClearSel) {
      els.ptClearSel.onclick = () => {
        state.selectedSU = null;
        state.selectedRackProcessRunId = null;
        state.selectedStatusId = null;
        renderAll();
      };
    }

    // Rack dropdown: racks within selected SU for selected process
    if (els.ptRack) {
      els.ptRack.innerHTML = "";
      els.ptRack.disabled = true;

      if (state.selectedSU != null) {
        const suRows = rows.filter((r) => parseSUToNumber(r.SU) === state.selectedSU);
        const options = suRows
          .map((r) => ({
            id: r.rack_process_run_id,
            label: `${r.rack_id || r.rack_name || "Rack"} (${r.current_status || "—"})`,
            row: r,
          }))
          .filter((x) => x.id != null);

        if (options.length > 0) {
          els.ptRack.disabled = false;

          const opt0 = document.createElement("option");
          opt0.value = "";
          opt0.textContent = "Select rack...";
          els.ptRack.appendChild(opt0);

          options.forEach((o) => {
            const opt = document.createElement("option");
            opt.value = String(o.id);
            opt.textContent = o.label;
            els.ptRack.appendChild(opt);
          });

          // keep selection if exists
          if (state.selectedRackProcessRunId) {
            els.ptRack.value = String(state.selectedRackProcessRunId);
          }

          els.ptRack.onchange = () => {
            const v = els.ptRack.value;
            state.selectedRackProcessRunId = v ? Number(v) : null;
            state.selectedStatusId = null;
            renderAll();
          };

          els.ptRackHint && (els.ptRackHint.textContent = `Racks in SU${String(state.selectedSU).padStart(2, "0")}: ${options.length}`);
        } else {
          els.ptRackHint && (els.ptRackHint.textContent = "No racks found for this SU/process.");
        }
      } else {
        els.ptRackHint && (els.ptRackHint.textContent = "Click a SU on the map to select.");
      }
    }

    // Status dropdown:
    // We build possible statuses from runs list (distinct status_id + current_status)
    if (els.ptStatus) {
      els.ptStatus.innerHTML = "";
      els.ptStatus.disabled = true;

      const statusMap = new Map(); // status_id -> name
      for (const r of state.runs) {
        if (r.status_id != null && r.current_status) {
          statusMap.set(Number(r.status_id), normStr(r.current_status));
        }
      }
      const statuses = Array.from(statusMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (state.selectedRackProcessRunId && statuses.length > 0) {
        els.ptStatus.disabled = false;

        const opt0 = document.createElement("option");
        opt0.value = "";
        opt0.textContent = "Select status...";
        els.ptStatus.appendChild(opt0);

        statuses.forEach((s) => {
          const opt = document.createElement("option");
          opt.value = String(s.id);
          opt.textContent = s.name;
          els.ptStatus.appendChild(opt);
        });

        if (state.selectedStatusId) {
          els.ptStatus.value = String(state.selectedStatusId);
        }

        els.ptStatus.onchange = () => {
          const v = els.ptStatus.value;
          state.selectedStatusId = v ? Number(v) : null;
          renderApplyButtonState();
        };

        els.ptStatusHint && (els.ptStatusHint.textContent = "");
      } else {
        els.ptStatusHint && (els.ptStatusHint.textContent = state.selectedRackProcessRunId ? "No statuses found." : "Select a rack first.");
      }
    }

    renderApplyButtonState();
  }

  function renderApplyButtonState() {
    if (!els.ptApplyStatus) return;

    const can =
      state.selectedRackProcessRunId != null &&
      state.selectedStatusId != null;

    els.ptApplyStatus.disabled = !can;

    if (els.ptApplyHint) {
      els.ptApplyHint.textContent = can ? "" : "Select rack + status to enable Update Status.";
    }
  }

  // -----------------------------
  // Responsible modal
  // -----------------------------
  const RESPONSIBLES = [
    // You can replace with your real employees list later.
    // For demo we use a fixed list.
    { id: 999, name: "Admin (demo)" },
    { id: 101, name: "Operator A" },
    { id: 102, name: "Operator B" },
  ];

  function ensureResponsibleOptions() {
    if (!els.respSelect) return;
    if (els.respSelect.options.length > 0) return;

    RESPONSIBLES.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = String(r.id);
      opt.textContent = r.name;
      els.respSelect.appendChild(opt);
    });
  }

  function openResponsibleModal() {
    return new Promise((resolve) => {
      ensureResponsibleOptions();

      const modal = els.respModal;
      const sel = els.respSelect;
      const ok = els.respOk;
      const cancel = els.respCancel;

      // fallback: prompt if modal not present
      if (!modal || !sel || !ok || !cancel) {
        const who = window.prompt("Responsible employee id (e.g. 999):", "999");
        resolve(who ? Number(who) : 999);
        return;
      }

      modal.classList.add("open"); // your CSS may use .open; if not, it still works (just hidden)
      modal.style.display = "block";

      const cleanup = () => {
        modal.classList.remove("open");
        modal.style.display = "none";
        ok.onclick = null;
        cancel.onclick = null;
      };

      cancel.onclick = () => {
        cleanup();
        resolve(null);
      };

      ok.onclick = () => {
        const v = Number(sel.value || 999);
        cleanup();
        resolve(v);
      };
    });
  }

  // -----------------------------
  // Update status action
  // -----------------------------
  async function onApplyStatus() {
    if (!state.selectedRackProcessRunId || !state.selectedStatusId) return;

    try {
      els.ptApplyStatus && (els.ptApplyStatus.disabled = true);
      els.ptApplyHint && (els.ptApplyHint.textContent = "Updating...");

      const employeeId = await openResponsibleModal();
      if (employeeId == null) {
        els.ptApplyHint && (els.ptApplyHint.textContent = "Cancelled.");
        renderApplyButtonState();
        return;
      }

      const note = normStr(els.ptNote?.value);

      await apiUpdateStatus({
        rack_process_run_id: state.selectedRackProcessRunId,
        status_id: state.selectedStatusId,
        responsible_employee_id: employeeId,
        note,
      });

      els.ptApplyHint && (els.ptApplyHint.textContent = "✅ Updated. Reloading...");
      await reloadRunsAndRender();

      // optional: clear note after success
      if (els.ptNote) els.ptNote.value = "";

      els.ptApplyHint && (els.ptApplyHint.textContent = "✅ Done.");
    } catch (e) {
      console.error(e);
      els.ptApplyHint && (els.ptApplyHint.textContent = `❌ ${e.message}`);
      renderApplyButtonState();
    }
  }

  // -----------------------------
  // Click handling on SU nodes
  // -----------------------------
  function bindSUClicksOnce() {
    // Many spans exist; bind once.
    // We use event delegation on document.
    document.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;

      const su = t.closest(".su");
      if (!su) return;

      const key = su.getAttribute("data-su");
      const n = Number(key);
      if (!Number.isFinite(n)) return;

      state.selectedSU = n;
      state.selectedRackProcessRunId = null;
      state.selectedStatusId = null;
      renderAll();
    });
  }

  // -----------------------------
  // Zoom (optional, safe)
  // -----------------------------
  let zoomPct = 100;

  function setZoom(pct) {
    zoomPct = Math.max(50, Math.min(200, pct));
    const z = $("#matrixZoom");
    if (z) z.style.transform = `scale(${zoomPct / 100})`;
    const label = $("#zoomPct");
    if (label) label.textContent = `${zoomPct}%`;
  }

  function bindZoom() {
    const zin = $("#zoomIn");
    const zout = $("#zoomOut");
    const zreset = $("#zoomReset");

    zin && zin.addEventListener("click", () => setZoom(zoomPct + 10));
    zout && zout.addEventListener("click", () => setZoom(zoomPct - 10));
    zreset && zreset.addEventListener("click", () => setZoom(100));
  }

  // -----------------------------
  // Reload / Render pipeline
  // -----------------------------
  async function reloadRunsAndRender() {
    const data = await apiGetRuns(1000);
    state.runs = Array.isArray(data) ? data : [];
    renderAll();
  }

  function renderAll() {
    // toggles
    state.problemsOnly = !!els.problemsOnly?.checked;
    state.qcOnly = !!els.qcOnly?.checked;

    renderProcessChips();
    renderMatrix();
    renderSidebar();

    // apply button
    if (els.ptApplyStatus) {
      els.ptApplyStatus.onclick = onApplyStatus;
    }
  }

  // -----------------------------
  // Init
  // -----------------------------
  async function init() {
    // bind toggles
    els.problemsOnly && els.problemsOnly.addEventListener("change", renderAll);
    els.qcOnly && els.qcOnly.addEventListener("change", renderAll);

    // search re-render
    els.ptSearch && els.ptSearch.addEventListener("input", () => renderAll());

    bindSUClicksOnce();
    bindZoom();
    setZoom(100);

    // first load
    try {
      await reloadRunsAndRender();
    } catch (e) {
      console.error(e);
      // If UI has a place to show error, do it:
      if (els.ptApplyHint) els.ptApplyHint.textContent = `❌ Failed to load runs: ${e.message}`;
    }
  }

  // run
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
