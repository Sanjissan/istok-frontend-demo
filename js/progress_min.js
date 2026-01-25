(function () {
  const RUN_ID = 469; // поменяй если нужно
  const API_BASE = ""; // если у тебя /api на том же домене

  async function fetchJSON(url, opts = {}) {
    const res = await fetch(API_BASE + url, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      cache: "no-store",
      ...opts,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) n.append(c);
    return n;
  }

  function pretty(x) {
    try { return JSON.stringify(x, null, 2); } catch { return String(x); }
  }

  async function loadRun() {
    const rows = await fetchJSON(`/api/runs?limit=20000&_=${Date.now()}`);
    const row = (rows || []).find(r => Number(r.rack_process_run_id || r.run_id || r.id) === RUN_ID);
    return row || null;
  }

  async function updateRun(status_id, note) {
    return fetchJSON(`/api/runs/status`, {
      method: "POST",
      body: JSON.stringify({
        rack_process_run_id: RUN_ID,
        status_id: Number(status_id),
        note: note ? String(note) : null,
      }),
    });
  }

  // UI
  const root = el("div", {
    class: "pt-min",
    style: `
      position: fixed; right: 16px; bottom: 16px; width: 420px;
      background: rgba(0,0,0,.85); color: #fff; border: 1px solid rgba(255,255,255,.12);
      border-radius: 16px; padding: 14px; z-index: 999999; font-family: system-ui, -apple-system, Segoe UI, Roboto;
    `,
  });

  const title = el("div", { style: "font-weight:800; font-size: 14px; margin-bottom: 8px;" }, [
    document.createTextNode("PT MIN TEST (backend truth)"),
  ]);

  const meta = el("div", { style: "font-size: 12px; opacity: .85; margin-bottom: 10px;" }, [
    document.createTextNode(`RUN_ID = ${RUN_ID}`),
  ]);

  const pre = el("pre", {
    style: `
      max-height: 220px; overflow:auto; padding: 10px; border-radius: 12px;
      background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.08);
      font-size: 11px;
    `,
  }, [document.createTextNode("loading...")]);

  const statusInput = el("input", {
    type: "number",
    placeholder: "status_id (number)",
    style: "width: 100%; height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color:#fff; padding: 0 10px; margin-top: 10px;"
  });

  const noteInput = el("input", {
    type: "text",
    placeholder: "note",
    style: "width: 100%; height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color:#fff; padding: 0 10px; margin-top: 8px;"
  });

  const btnRow = el("div", { style: "display:flex; gap:8px; margin-top: 10px;" });

  const btnReload = el("button", {
    style: "flex:1; height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.08); color:#fff; font-weight:800; cursor:pointer;",
    onclick: async () => {
      try {
        pre.textContent = "loading...";
        const row = await loadRun();
        pre.textContent = row ? pretty(row) : "NOT FOUND in /api/runs?limit=20000";
        if (row) {
          statusInput.value = row.status_id ?? "";
          noteInput.value = row.note ?? "";
        }
      } catch (e) {
        pre.textContent = "ERROR: " + (e && e.message ? e.message : String(e));
      }
    }
  }, [document.createTextNode("Reload")]);

  const btnSave = el("button", {
    style: "flex:1; height: 34px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(50,213,131,.18); color:#fff; font-weight:900; cursor:pointer;",
    onclick: async () => {
      try {
        pre.textContent = "saving...";
        const resp = await updateRun(statusInput.value, noteInput.value);
        pre.textContent = "SAVE RESPONSE:\n" + pretty(resp);
      } catch (e) {
        pre.textContent = "SAVE ERROR: " + (e && e.message ? e.message : String(e));
      }
    }
  }, [document.createTextNode("Save")]);

  btnRow.append(btnReload, btnSave);

  root.append(title, meta, pre, statusInput, noteInput, btnRow);
  document.body.appendChild(root);

  // initial load
  btnReload.click();
})();
