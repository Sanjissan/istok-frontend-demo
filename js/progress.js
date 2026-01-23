/* js/progress.js
 *
 * Работает с беком:
 *   GET  /api/runs?limit=1000
 *   POST /api/runs/status   { rack_process_run_id, status_id, responsible_employee_id?, note? }
 *
 * Требует api.js:
 *   window.PT_API.fetchJSON()
 */

(function () {
  "use strict";

  // -----------------------------
  // Helpers
  // -----------------------------
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function safeText(v) {
    return (v === null || v === undefined) ? "" : String(v);
  }

  function uniqBy(arr, keyFn) {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const k = keyFn(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }

  function normalizeStatusName(name) {
    return safeText(name).trim().toUpperCase();
  }

  function statusBucket(nameUpper) {
    const n = nameUpper || "";
    if (!n) return "UNKNOWN";
    if (n.includes("NOT STARTED")) return "NOT_STARTED";
    if (n.includes("QC DONE") || n === "DONE" || n.includes("DONE") || n.includes("FINISH")) return "QC_DONE";
    return "IN_PROGRESS";
  }

  function setBar(elFill, elPct, pct) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    if (elFill) elFill.style.width = `${p}%`;
    if (elPct) elPct.textContent = `${p}%`;
  }

  function showError(msg) {
    console.error(msg);
    const hint = $("ptApplyHint");
    if (hint) {
      hint.textContent = msg;
      hint.style.color = "#ff6b6b";
    } else {
      alert(msg);
    }
  }

  function showInfo(msg) {
    const hint = $("ptApplyHint");
    if (hint) {
      hint.textContent = msg;
      hint.style.color = "#9be7ff";
      setTimeout(() => {
        if (hint.textContent === msg) hint.textContent = "";
      }, 2500);
    }
  }

  // -----------------------------
  // API (через PT_API.fetchJSON)
  // -----------------------------
  const API = window.PT_API && typeof window.PT_API.fetchJSON === "function"
    ? window.PT_API
    : null;

  async function apiFetchJSON(path, opts) {
    if (!API) throw new Error("PT_API.fetchJSON not found. Проверь js/api.js и что он подключён в index.html");
    return API.fetchJSON(path, opts);
  }

  async function apiGetRuns(limit = 1000) {
    return apiFetchJSON(`/api/runs?limit=${encodeURIComponent(limit)}`);
  }

  async function apiUpdateStatus(payload) {
    return apiFetchJSON(`/api/runs/status`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    runs: [],
    bySU: new Map(),   // suKey -> rows
    suKeys: [],
    statuses: [],      // [{id, name}]
    selected: {
      suKey: null,
      rackId: null,
      processId: null,
      rackProcessRunId: null,
    },
    ui: {
      zoom: 100,
    }
  };

  // -----------------------------
  // DOM refs (IDs из твоего HTML)
  // -----------------------------
  const dom = {
    problemsOnly: $("problemsOnly"),
    qcOnly: $("qcOnly"),
    search: $("ptSearch"),
    sideSearch: $("ptSideSearch"),

    matrixRoot: $("matrixRoot"),
    processChips: $("ptProcessChips"),

    panelTitle: $("ptPanelTitle"),
    panelSub: $("ptPanelSub"),

    barNotStarted: $("barNotStarted"),
    barInProgress: $("barInProgress"),
    barQCDone: $("barQCDone"),
    pctNotStarted: $("pctNotStarted"),
    pctInProgress: $("pctInProgress"),
    pctQCDone: $("pctQCDone"),

    ptRack: $("ptRack"),
    ptRackHint: $("ptRackHint"),
    ptRackProcess: $("ptRackProcess"),
    ptRackProcessHint: $("ptRackProcessHint"),
    ptStatus: $("ptStatus"),
    ptStatusHint: $("ptStatusHint"),
    ptNote: $("ptNote"),
    ptApplyStatus: $("ptApplyStatus"),
    ptApplyHint: $("ptApplyHint"),
    ptClearSel: $("ptClearSel"),

    respModal: $("ptRespModal"),
    respSelect: $("ptRespSelect"),
    respOk: $("ptRespOk"),
    respCancel: $("ptRespCancel"),

    zoomIn: $("zoomIn"),
    zoomOut: $("zoomOut"),
    zoomReset: $("zoomReset"),
    zoomPct: $("zoomPct"),
    matrixZoom: $("matrixZoom"),
  };

  // -----------------------------
  // Indexes
  // -----------------------------
  function rebuildIndexes() {
    state.bySU.clear();

    for (const row of state.runs) {
      const suKey = safeText(row.SU || row.su || "").replace(/^SU/i, "").trim();
      if (!suKey) continue;
      if (!state.bySU.has(suKey)) state.bySU.set(suKey, []);
      state.bySU.get(suKey).push(row);
    }

    state.suKeys = Array.from(state.bySU.keys()).sort((a, b) => Number(a) - Number(b));

    // статусы вытаскиваем из данных (у тебя status_id + current_status)
    const uniqStatuses = uniqBy(
      state.runs
        .filter(r => r.status_id && r.current_status)
        .map(r => ({ id: Number(r.status_id), name: safeText(r.current_status) })),
      s => s.id
    ).sort((a, b) => a.id - b.id);

    state.statuses = uniqStatuses;
  }

  // -----------------------------
  // UI enable/disable
  // -----------------------------
  function disableUpdateControls(hard = false) {
    if (dom.ptRack) dom.ptRack.disabled = true;
    if (dom.ptRackProcess) dom.ptRackProcess.disabled = true;
    if (dom.ptStatus) dom.ptStatus.disabled = true;
    if (dom.ptNote) dom.ptNote.disabled = true;
    if (dom.ptApplyStatus) dom.ptApplyStatus.disabled = true;

    if (hard && dom.ptApplyHint) dom.ptApplyHint.textContent = "";
  }

  function enableUpdateControls() {
    const hasSU = !!state.selected.suKey;
    const hasRack = !!state.selected.rackId;
    const hasRun = !!state.selected.rackProcessRunId;
    const hasStatus = dom.ptStatus && dom.ptStatus.value;

    if (dom.ptRack) dom.ptRack.disabled = !hasSU;
    if (dom.ptRackProcess) dom.ptRackProcess.disabled = !hasRack;
    if (dom.ptStatus) dom.ptStatus.disabled = !hasRun;
    if (dom.ptNote) dom.ptNote.disabled = !hasRun;

    if (dom.ptApplyStatus) {
      dom.ptApplyStatus.disabled = !(hasRun && hasStatus);
    }
  }

  // -----------------------------
  // Render helpers (минимально — чтобы всё работало)
  // -----------------------------
  function renderProcessChips() {
    // если тебе нужно — можно красиво заполнить чипсы по уникальным process_name
    // сейчас оставим пусто (UI не ломаем)
    if (!dom.processChips) return;
    dom.processChips.innerHTML = "";
  }

  function renderMatrix() {
    // ВАЖНО: мы не перерисовываем твою огромную матрицу HTML (она уже есть в index.html).
    // Мы просто красим элементы .su по данным.
    const allSU = qsa(".su", dom.matrixRoot || document);
    for (const el of allSU) {
      el.classList.remove("ok", "warn", "bad", "selected");
    }

    // подсветка выбранного SU
    if (state.selected.suKey) {
      for (const el of allSU) {
        const key = safeText(el.dataset.su || "");
        if (key && String(key).includes(`SU${state.selected.suKey}`)) {
          el.classList.add("selected");
        }
      }
    }
  }

  function refreshPanelStats() {
    if (!dom.panelTitle) return;

    const rows = state.selected.suKey ? (state.bySU.get(state.selected.suKey) || []) : state.runs;

    const counts = { NOT_STARTED: 0, IN_PROGRESS: 0, QC_DONE: 0 };
    for (const r of rows) {
      const bucket = statusBucket(normalizeStatusName(r.current_status));
      if (counts[bucket] !== undefined) counts[bucket] += 1;
    }

    const total = rows.length || 1;
    setBar(dom.barNotStarted, dom.pctNotStarted, (counts.NOT_STARTED / total) * 100);
    setBar(dom.barInProgress, dom.pctInProgress, (counts.IN_PROGRESS / total) * 100);
    setBar(dom.barQCDone, dom.pctQCDone, (counts.QC_DONE / total) * 100);

    dom.panelTitle.textContent = state.selected.suKey ? `SU${state.selected.suKey}` : "—";
    if (dom.panelSub) dom.panelSub.textContent = `Rows: ${rows.length}`;
  }

  function refillSelectorsFromSelection() {
    // Rack dropdown
    if (dom.ptRack) {
      const rows = state.selected.suKey ? (state.bySU.get(state.selected.suKey) || []) : [];
      const racks = uniqBy(rows.map(r => ({
        id: safeText(r.rack_id || r.rackId || r.rack_name || r.rack_name),
        name: safeText(r.rack_name || r.rackName || r.rack_id),
      })), x => x.id).filter(x => x.id);

      dom.ptRack.innerHTML = "";
      dom.ptRack.appendChild(new Option("Select rack…", ""));
      for (const r of racks) dom.ptRack.appendChild(new Option(r.name || r.id, r.id));

      if (state.selected.rackId) dom.ptRack.value = state.selected.rackId;
    }

    // RackProcess dropdown (по rack)
    if (dom.ptRackProcess) {
      dom.ptRackProcess.innerHTML = "";
      dom.ptRackProcess.appendChild(new Option("Select process…", ""));

      if (state.selected.suKey && state.selected.rackId) {
        const rows = (state.bySU.get(state.selected.suKey) || []).filter(r => safeText(r.rack_id) === state.selected.rackId);
        const procs = uniqBy(rows.map(r => ({
          id: Number(r.rack_process_run_id),
          name: safeText(r.process_name),
          processId: Number(r.process_id),
        })), x => x.id).filter(x => Number.isFinite(x.id));

        for (const p of procs) dom.ptRackProcess.appendChild(new Option(p.name, String(p.id)));
        if (state.selected.rackProcessRunId) dom.ptRackProcess.value = String(state.selected.rackProcessRunId);
      }
    }

    // Status dropdown
    if (dom.ptStatus) {
      dom.ptStatus.innerHTML = "";
      dom.ptStatus.appendChild(new Option("Select status…", ""));
      for (const s of state.statuses) {
        dom.ptStatus.appendChild(new Option(s.name, String(s.id)));
      }
    }

    enableUpdateControls();
  }

  // -----------------------------
  // Click apply
  // -----------------------------
  async function onApplyStatus() {
    try {
      if (!state.selected.rackProcessRunId) {
        showError("Select rack process first.");
        return;
      }
      const statusId = dom.ptStatus && dom.ptStatus.value ? Number(dom.ptStatus.value) : null;
      if (!statusId) {
        showError("Select status.");
        return;
      }

      const note = dom.ptNote ? safeText(dom.ptNote.value).trim() : "";
      const payload = {
        rack_process_run_id: Number(state.selected.rackProcessRunId),
        status_id: Number(statusId),
        responsible_employee_id: 999,
        note: note || null,
      };

      if (dom.ptApplyStatus) dom.ptApplyStatus.disabled = true;
      showInfo("Updating...");

      await apiUpdateStatus(payload);

      showInfo("✅ Updated");
      await reloadRunsAndRender(); // ВАЖНО: перезагрузить, чтобы после refresh не откатывалось
    } catch (e) {
      showError(e?.message || "Failed to update");
    } finally {
      enableUpdateControls();
    }
  }

  // -----------------------------
  // Fetch + render
  // -----------------------------
  async function reloadRunsAndRender() {
    const runs = await apiGetRuns(1000);
    state.runs = Array.isArray(runs) ? runs : [];
    rebuildIndexes();
    renderProcessChips();
    renderMatrix();
    refillSelectorsFromSelection();
    refreshPanelStats();
  }

  // -----------------------------
  // Bind UI
  // -----------------------------
  function bindUI() {
    if (dom.search) dom.search.addEventListener("input", () => {
      renderMatrix();
      refreshPanelStats();
      refillSelectorsFromSelection();
    });

    if (dom.problemsOnly) dom.problemsOnly.addEventListener("change", () => {
      renderMatrix();
      refreshPanelStats();
    });

    if (dom.qcOnly) dom.qcOnly.addEventListener("change", () => {
      renderMatrix();
      refreshPanelStats();
    });

    if (dom.ptRack) dom.ptRack.addEventListener("change", () => {
      state.selected.rackId = dom.ptRack.value || null;
      state.selected.rackProcessRunId = null;
      refillSelectorsFromSelection();
      enableUpdateControls();
    });

    if (dom.ptRackProcess) dom.ptRackProcess.addEventListener("change", () => {
      state.selected.rackProcessRunId = dom.ptRackProcess.value ? Number(dom.ptRackProcess.value) : null;
      refillSelectorsFromSelection();
      enableUpdateControls();
    });

    if (dom.ptStatus) dom.ptStatus.addEventListener("change", () => {
      enableUpdateControls();
    });

    if (dom.ptApplyStatus) dom.ptApplyStatus.addEventListener("click", (e) => {
      e.preventDefault();
      onApplyStatus();
    });

    if (dom.ptClearSel) dom.ptClearSel.addEventListener("click", () => {
      state.selected.suKey = null;
      state.selected.rackId = null;
      state.selected.rackProcessRunId = null;
      refillSelectorsFromSelection();
      refreshPanelStats();
      renderMatrix();
    });

    // Zoom controls
    function applyZoom() {
      if (dom.matrixZoom) dom.matrixZoom.style.transform = `scale(${state.ui.zoom / 100})`;
      if (dom.zoomPct) dom.zoomPct.textContent = `${state.ui.zoom}%`;
    }

    if (dom.zoomIn) dom.zoomIn.addEventListener("click", () => {
      state.ui.zoom = Math.min(200, state.ui.zoom + 10);
      applyZoom();
    });
    if (dom.zoomOut) dom.zoomOut.addEventListener("click", () => {
      state.ui.zoom = Math.max(50, state.ui.zoom - 10);
      applyZoom();
    });
    if (dom.zoomReset) dom.zoomReset.addEventListener("click", () => {
      state.ui.zoom = 100;
      applyZoom();
    });

    applyZoom();

    // Выбор SU кликом по матрице
    // В твоём HTML .su имеет data-su="SUxx..." — мы парсим номер SU
    qsa(".su", dom.matrixRoot || document).forEach((el) => {
      el.addEventListener("click", () => {
        const ds = safeText(el.dataset.su || "");
        const m = ds.match(/SU\s*0*([0-9]+)/i);
        if (!m) return;
        state.selected.suKey = String(Number(m[1])); // "01" -> "1"
        state.selected.rackId = null;
        state.selected.rackProcessRunId = null;
        refillSelectorsFromSelection();
        refreshPanelStats();
        renderMatrix();
      });
    });
  }

  // -----------------------------
  // Init
  // -----------------------------
  async function init() {
    try {
      bindUI();
      disableUpdateControls(true);
      await reloadRunsAndRender(); // после этого в Network должен быть /api/runs?limit=1000
    } catch (e) {
      console.error(e);
      showError(e?.message || "Init failed");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
