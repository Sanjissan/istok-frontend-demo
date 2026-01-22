// frontend/js/progress.js
(function () {
  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);

  function toIntSU(value) {
    // value like "SU01" -> 1, or "1" -> 1
    if (value == null) return null;
    const s = String(value).trim().toUpperCase();
    if (s.startsWith("SU")) return Number(s.replace(/^SU0*/i, ""));
    const n = Number(s.replace(/\D+/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function setHint(el, text) {
    if (!el) return;
    el.textContent = text || "";
  }

  function setDisabled(el, disabled) {
    if (!el) return;
    el.disabled = !!disabled;
  }

  function fillSelect(selectEl, items, getValue, getLabel, placeholder = "— Select —") {
    if (!selectEl) return;
    selectEl.innerHTML = "";

    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    selectEl.appendChild(ph);

    for (const it of items) {
      const opt = document.createElement("option");
      opt.value = String(getValue(it));
      opt.textContent = String(getLabel(it));
      selectEl.appendChild(opt);
    }
  }

  // ---------- state ----------
  let RUNS = [];
  let STATUS_LIST = []; // optional if /api/statuses exists

  let selectedSU = null; // number
  let selectedRackRunRows = []; // rows for selected SU (all processes)
  let selectedRackId = null; // rack_id string (from view)
  let selectedProcessId = null; // number

  // DOM
  const elProcessChips = $("ptProcessChips");
  const elRack = $("ptRack");
  const elRackHint = $("ptRackHint");
  const elRackProcess = $("ptRackProcess");
  const elRackProcessHint = $("ptRackProcessHint");
  const elStatus = $("ptStatus");
  const elStatusHint = $("ptStatusHint");
  const elNote = $("ptNote");
  const elApply = $("ptApplyStatus");
  const elApplyHint = $("ptApplyHint");
  const elClearSel = $("ptClearSel");

  const elPanelTitle = $("ptPanelTitle");
  const elPanelSub = $("ptPanelSub");

  const elBarNotStarted = $("barNotStarted");
  const elBarInProgress = $("barInProgress");
  const elBarQCDone = $("barQCDone");
  const elPctNotStarted = $("pctNotStarted");
  const elPctInProgress = $("pctInProgress");
  const elPctQCDone = $("pctQCDone");

  // modal (responsible)
  const elRespModal = $("ptRespModal");
  const elRespSelect = $("ptRespSelect");
  const elRespOk = $("ptRespOk");
  const elRespCancel = $("ptRespCancel");

  // If у тебя есть таблица employees и хочешь красиво — можно позже подгрузить
  // Сейчас делаем просто prompt или "999" (как в твоем backend).
  async function pickResponsibleEmployeeId() {
    // Если модалки нет — fallback prompt
    if (!elRespModal || !elRespSelect || !elRespOk || !elRespCancel) {
      const raw = window.prompt("Responsible employee id? (empty = 999)", "999");
      const n = Number(String(raw || "").trim());
      return Number.isFinite(n) && n > 0 ? n : 999;
    }

    // Если модалка есть — используем её
    return new Promise((resolve) => {
      elRespModal.style.display = "flex";

      // если там пусто — сделаем хотя бы 999
      if (!elRespSelect.options.length) {
        elRespSelect.innerHTML = "";
        const opt = document.createElement("option");
        opt.value = "999";
        opt.textContent = "999 (Demo)";
        elRespSelect.appendChild(opt);
      }

      const cleanup = () => {
        elRespModal.style.display = "none";
        elRespOk.onclick = null;
        elRespCancel.onclick = null;
      };

      elRespOk.onclick = () => {
        const n = Number(elRespSelect.value || "999");
        cleanup();
        resolve(Number.isFinite(n) && n > 0 ? n : 999);
      };

      elRespCancel.onclick = () => {
        cleanup();
        resolve(null);
      };
    });
  }

  // ---------- rendering ----------
  function computeSUStats(rows) {
    // rows = all runs for selected SU
    const total = rows.length || 1;

    const isNotStarted = (name) => String(name || "").toUpperCase().includes("NOT STARTED");
    const isQCDone = (name) => String(name || "").toUpperCase().includes("QC DONE") || String(name || "").toUpperCase() === "DONE";

    let notStarted = 0;
    let qcDone = 0;
    let inProgress = 0;

    for (const r of rows) {
      const st = r.current_status || r.run_state || "";
      if (isNotStarted(st)) notStarted++;
      else if (isQCDone(st)) qcDone++;
      else inProgress++;
    }

    return {
      notStarted,
      inProgress,
      qcDone,
      total,
    };
  }

  function applyBars(stats) {
    const pct = (n) => Math.round((n / stats.total) * 100);

    const pNS = pct(stats.notStarted);
    const pIP = pct(stats.inProgress);
    const pQC = pct(stats.qcDone);

    if (elBarNotStarted) elBarNotStarted.style.width = `${pNS}%`;
    if (elBarInProgress) elBarInProgress.style.width = `${pIP}%`;
    if (elBarQCDone) elBarQCDone.style.width = `${pQC}%`;

    if (elPctNotStarted) elPctNotStarted.textContent = `${pNS}%`;
    if (elPctInProgress) elPctInProgress.textContent = `${pIP}%`;
    if (elPctQCDone) elPctQCDone.textContent = `${pQC}%`;
  }

  function clearAllHighlights() {
    document.querySelectorAll(".su[data-su]").forEach((el) => {
      el.classList.remove("pt-selected");
      el.classList.remove("pt-hasdata");
      // статусные классы
      el.classList.forEach((c) => {
        if (c.startsWith("pt-status-")) el.classList.remove(c);
      });
      el.removeAttribute("title");
    });
  }

  function highlightFromRuns(runs) {
    clearAllHighlights();

    // Берем последние статусы по SU (если в су много рэков — можно выбирать самый "плохой" статус)
    // Для демо: просто ставим класс по первому попавшемуся статусу
    const bySU = new Map(); // suNumber -> {statusName, count}
    for (const r of runs) {
      const suN = toIntSU(r.SU);
      if (!suN) continue;
      if (!bySU.has(suN)) {
        bySU.set(suN, { status: r.current_status || "", count: 0 });
      }
      bySU.get(suN).count++;
    }

    document.querySelectorAll(".su[data-su]").forEach((el) => {
      const suAttr = el.getAttribute("data-su");
      const suN = toIntSU(suAttr);
      if (!suN) return;

      const info = bySU.get(suN);
      if (!info) return;

      el.classList.add("pt-hasdata");

      const st = info.status || "";
      if (st) {
        el.classList.add(`pt-status-${slug(st)}`);
        el.title = `${el.textContent?.trim() || "SU"} • ${st} • runs:${info.count}`;
      } else {
        el.title = `${el.textContent?.trim() || "SU"} • runs:${info.count}`;
      }
    });
  }

  function setPanelHeader() {
    if (elPanelTitle) elPanelTitle.textContent = selectedSU ? `SU${String(selectedSU).padStart(2, "0")}` : "—";
    if (elPanelSub) elPanelSub.textContent = selectedSU ? "Select Rack → Process → Status" : "Click any SU on the map";
  }

  function getRowsForSelectedSU() {
    if (!selectedSU) return [];
    return RUNS.filter((r) => toIntSU(r.SU) === selectedSU);
  }

  function getRackOptions(rows) {
    // unique by rack_id
    const map = new Map();
    for (const r of rows) {
      if (!r.rack_id) continue;
      if (!map.has(r.rack_id)) {
        map.set(r.rack_id, r);
      }
    }
    // sort by rack_row + rack_name if exists
    return Array.from(map.values()).sort((a, b) => {
      const ar = Number(a.rack_row || 0);
      const br = Number(b.rack_row || 0);
      if (ar !== br) return ar - br;
      return String(a.rack_name || a.rack_id).localeCompare(String(b.rack_name || b.rack_id));
    });
  }

  function getProcessOptions(rows, rackId) {
    const map = new Map();
    for (const r of rows) {
      if (rackId && r.rack_id !== rackId) continue;
      const pid = Number(r.process_id);
      if (!pid) continue;
      if (!map.has(pid)) map.set(pid, r);
    }
    return Array.from(map.values()).sort((a, b) => Number(a.process_id) - Number(b.process_id));
  }

  function getStatusOptions() {
    // если есть /api/statuses
    if (Array.isArray(STATUS_LIST) && STATUS_LIST.length) {
      return STATUS_LIST.slice().sort((a, b) => Number(a.id) - Number(b.id));
    }

    // fallback: вытащим статусы из runs (у тебя есть current_status, но там нет status_id для выбора)
    // поэтому в fallback дадим только "105 PATCHING DONE" условно нельзя. Лучше требовать /api/statuses.
    return [];
  }

  function updateSidebarUI() {
    setPanelHeader();

    const rows = getRowsForSelectedSU();
    selectedRackRunRows = rows;

    // bars
    applyBars(computeSUStats(rows));

    // rack select
    const racks = getRackOptions(rows);
    fillSelect(elRack, racks, (r) => r.rack_id, (r) => `${r.rack_name || r.rack_id} (row ${r.rack_row ?? "?"})`, "— Select Rack —");
    setDisabled(elRack, !selectedSU || racks.length === 0);
    setHint(elRackHint, selectedSU ? `${racks.length} racks in this SU` : "");

    // reset dependent
    selectedRackId = null;
    selectedProcessId = null;

    fillSelect(elRackProcess, [], () => "", () => "", "— Select Process —");
    setDisabled(elRackProcess, true);
    setHint(elRackProcessHint, "");

    fillSelect(elStatus, [], () => "", () => "", "— Select Status —");
    setDisabled(elStatus, true);
    setHint(elStatusHint, "");

    if (elNote) {
      elNote.value = "";
      setDisabled(elNote, true);
    }

    if (elApply) setDisabled(elApply, true);
    setHint(elApplyHint, "");
  }

  function markSelectedSUOnMap(suNumber) {
    document.querySelectorAll(".su[data-su]").forEach((el) => el.classList.remove("pt-selected"));
    document.querySelectorAll(".su[data-su]").forEach((el) => {
      const suN = toIntSU(el.getAttribute("data-su"));
      if (suN === suNumber) el.classList.add("pt-selected");
    });
  }

  // ---------- events ----------
  function wireMapClicks() {
    document.querySelectorAll(".su[data-su]").forEach((el) => {
      el.addEventListener("click", () => {
        const suN = toIntSU(el.getAttribute("data-su"));
        if (!suN) return;

        selectedSU = suN;
        markSelectedSUOnMap(selectedSU);
        updateSidebarUI();
      });
    });
  }

  function wireSelects() {
    if (elRack) {
      elRack.addEventListener("change", () => {
        selectedRackId = elRack.value || null;

        if (!selectedRackId) {
          fillSelect(elRackProcess, [], () => "", () => "", "— Select Process —");
          setDisabled(elRackProcess, true);
          setHint(elRackProcessHint, "");

          fillSelect(elStatus, [], () => "", () => "", "— Select Status —");
          setDisabled(elStatus, true);
          setHint(elStatusHint, "");

          if (elNote) {
            elNote.value = "";
            setDisabled(elNote, true);
          }
          if (elApply) setDisabled(elApply, true);
          return;
        }

        const procOpts = getProcessOptions(selectedRackRunRows, selectedRackId);
        fillSelect(elRackProcess, procOpts, (p) => p.process_id, (p) => p.process_name || `Process ${p.process_id}`, "— Select Process —");
        setDisabled(elRackProcess, procOpts.length === 0);
        setHint(elRackProcessHint, procOpts.length ? `${procOpts.length} processes` : "No processes found");

        // reset further
        selectedProcessId = null;

        fillSelect(elStatus, [], () => "", () => "", "— Select Status —");
        setDisabled(elStatus, true);
        setHint(elStatusHint, "");

        if (elNote) {
          elNote.value = "";
          setDisabled(elNote, true);
        }
        if (elApply) setDisabled(elApply, true);
      });
    }

    if (elRackProcess) {
      elRackProcess.addEventListener("change", async () => {
        selectedProcessId = elRackProcess.value ? Number(elRackProcess.value) : null;

        if (!selectedProcessId) {
          fillSelect(elStatus, [], () => "", () => "", "— Select Status —");
          setDisabled(elStatus, true);
          setHint(elStatusHint, "");
          if (elNote) {
            elNote.value = "";
            setDisabled(elNote, true);
          }
          if (elApply) setDisabled(elApply, true);
          return;
        }

        const statusOpts = getStatusOptions();
        if (!statusOpts.length) {
          setHint(elStatusHint, "Statuses endpoint missing. Create GET /api/statuses in backend.");
          setDisabled(elStatus, true);
          if (elApply) setDisabled(elApply, true);
          return;
        }

        fillSelect(elStatus, statusOpts, (s) => s.id, (s) => s.name, "— Select Status —");
        setDisabled(elStatus, false);
        setHint(elStatusHint, "");

        if (elNote) setDisabled(elNote, false);
      });
    }

    if (elStatus) {
      elStatus.addEventListener("change", () => {
        const ok = !!(elStatus.value && selectedRackId && selectedProcessId);
        if (elApply) setDisabled(elApply, !ok);
      });
    }

    if (elClearSel) {
      elClearSel.addEventListener("click", () => {
        selectedSU = null;
        selectedRackId = null;
        selectedProcessId = null;
        document.querySelectorAll(".su[data-su]").forEach((el) => el.classList.remove("pt-selected"));
        updateSidebarUI();
      });
    }

    if (elApply) {
      elApply.addEventListener("click", async () => {
        try {
          setHint(elApplyHint, "");
          if (!selectedSU || !selectedRackId || !selectedProcessId || !elStatus.value) {
            setHint(elApplyHint, "Select rack, process and status first.");
            return;
          }

          // Найдём rack_process_run_id по выбранным rack_id + process_id
          const row = selectedRackRunRows.find(
            (r) => r.rack_id === selectedRackId && Number(r.process_id) === Number(selectedProcessId)
          );

          if (!row || !row.rack_process_run_id) {
            setHint(elApplyHint, "Cannot find rack_process_run_id for selected rack/process.");
            return;
          }

          const status_id = Number(elStatus.value);
          const note = elNote ? String(elNote.value || "").trim() : "";

          const employeeId = await pickResponsibleEmployeeId();
          if (employeeId == null) {
            setHint(elApplyHint, "Cancelled.");
            return;
          }

          // CALL BACKEND
          await window.PT_API.postRunStatus({
            rack_process_run_id: Number(row.rack_process_run_id),
            status_id,
            responsible_employee_id: Number(employeeId),
            note: note || null,
          });

          setHint(elApplyHint, "✅ Updated. Refreshing…");

          // refresh data
          await reloadRunsAndRender();

          setHint(elApplyHint, "✅ Updated.");
        } catch (e) {
          console.error(e);
          setHint(elApplyHint, `❌ ${e.message}`);
        }
      });
    }
  }

  // ---------- load ----------
  async function reloadRunsAndRender() {
    RUNS = await window.PT_API.getRuns(1000);
    highlightFromRuns(RUNS);

    // если выбран SU — обновим сайдбар
    if (selectedSU) {
      markSelectedSUOnMap(selectedSU);
      updateSidebarUI();
    } else {
      updateSidebarUI();
    }
  }

  async function tryLoadStatuses() {
    // Если у тебя нет GET /api/statuses — просто оставим пусто
    try {
      const rows = await window.PT_API.getStatuses();
      // ожидаем [{id, name}, ...]
      if (Array.isArray(rows)) STATUS_LIST = rows;
    } catch {
      STATUS_LIST = [];
    }
  }

  // ---------- init ----------
  async function init() {
    if (!window.PT_API) {
      console.error("PT_API is missing. Check script order: api.js must load before progress.js");
      return;
    }

    wireMapClicks();
    wireSelects();
    setPanelHeader();

    await tryLoadStatuses();
    await reloadRunsAndRender();
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((e) => console.error(e));
  });
})();
