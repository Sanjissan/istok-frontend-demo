// js/app.js
import { fetchJSON } from "./api.js";
import { renderProgress } from "./progress.js";

const content = document.getElementById("content") || document.body;

async function load() {
  try {
    const data = await fetchJSON("/api/racks");
    renderProgress(content, data);
  } catch (err) {
    console.error(err);
    content.innerHTML = `<p style="color:red">Error: ${err.message}</p>`;
  }
}

load();
