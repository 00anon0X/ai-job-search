const STORAGE = {
  profile: "jobflow.profile",
  jobs: "jobflow.jobs"
};

const CSV_HEADERS = [
  "date", "company", "sector", "role", "role_type", "channel", "status", "contact_person",
  "fit_rating", "notes", "cv_file", "cover_letter_file", "source"
];

const SAMPLE_JOBS = [
  { id: "sample-1", date: "2026-06-01", company: "Northstar Health", sector: "Healthcare", role: "Product Analyst", role_type: "Analytics", channel: "Manual import", status: "analyzed", contact_person: "", fit_rating: "86", notes: "Strong match on analytics, stakeholder work, and operational improvements.", cv_file: "", cover_letter_file: "", source: "sample" },
  { id: "sample-2", date: "2026-06-03", company: "Atlas Robotics", sector: "Automation", role: "Operations Lead", role_type: "Leadership", channel: "Saved role", status: "saved", contact_person: "", fit_rating: "74", notes: "Good operations fit; clarify people-management expectations before applying.", cv_file: "", cover_letter_file: "", source: "sample" }
];

const DEFAULT_PROFILE = {
  roles: "Product analyst, operations lead, data scientist",
  skills: "analytics, automation, stakeholder management, Python, product thinking",
  dealbreakers: "No relocation, unclear compensation, heavy travel"
};

const state = {
  jobs: [],
  profile: DEFAULT_PROFILE,
  filters: { status: "all", query: "" },
  api: false
};

const $ = (selector) => document.querySelector(selector);

init();

async function init() {
  state.api = await detectApi();
  if (state.api) {
    const serverState = await apiJson("/api/state");
    state.profile = serverState.profile || DEFAULT_PROFILE;
    state.jobs = serverState.jobs?.length ? serverState.jobs : SAMPLE_JOBS;
  } else {
    state.profile = loadJson(STORAGE.profile, DEFAULT_PROFILE);
    state.jobs = loadJson(STORAGE.jobs, null) || await loadInitialJobs();
  }
  bindEvents();
  hydrateProfileForm();
  render();
  showMode();
}

async function detectApi() {
  try {
    const response = await fetch("/health", { cache: "no-store" });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload.service === "jobflow";
  } catch {
    return false;
  }
}

async function loadInitialJobs() {
  try {
    const response = await fetch("../job_search_tracker.csv");
    if (!response.ok) throw new Error(`CSV fetch failed: ${response.status}`);
    const rows = parseCsv(await response.text()).map((row, index) => ({ id: `csv-${index + 1}`, ...row, fit_rating: row.fit_rating || "0" })).filter((row) => row.company || row.role);
    return rows.length ? rows : SAMPLE_JOBS;
  } catch (error) {
    console.warn("Using sample tracker data", error);
    return SAMPLE_JOBS;
  }
}

function bindEvents() {
  $("#job-form").addEventListener("submit", submitJob);
  $("#fetch-url").addEventListener("click", fetchPosting);
  $("#clear-form").addEventListener("click", () => {
    $("#job-form").reset();
    $("#analysis-result").className = "analysis-result empty";
    $("#analysis-result").textContent = "Add a job to see fit score, gaps, and recommended next action.";
  });
  $("#profile-form").addEventListener("submit", saveProfile);
  $("#status-filter").addEventListener("change", (event) => { state.filters.status = event.target.value; renderTracker(); });
  $("#search-input").addEventListener("input", (event) => { state.filters.query = event.target.value.trim().toLowerCase(); renderTracker(); });
  $("#export-json").addEventListener("click", () => download("jobflow-export.json", JSON.stringify({ profile: state.profile, jobs: userJobs() }, null, 2), "application/json"));
  $("#export-csv").addEventListener("click", () => download("jobflow-tracker.csv", toCsv(userJobs()), "text/csv"));
  document.querySelectorAll(".nav-list a, .hero-actions a").forEach((link) => link.addEventListener("click", () => setActiveNav(link.getAttribute("href"))));
  window.addEventListener("hashchange", () => setActiveNav());
  setActiveNav();
  $("#reset-data").addEventListener("click", resetData);
}

async function submitJob(event) {
  event.preventDefault();
  const title = $("#job-title").value.trim();
  const company = $("#job-company").value.trim();
  const url = $("#job-url").value.trim();
  let description = $("#job-description").value.trim();
  if (/^https?:\/\/\S+$/i.test(description)) {
    showToast(state.api ? "Put the URL in the URL field, then click Fetch posting." : "Paste the job description too; static mode cannot fetch URLs.");
    return;
  }
  if (!title || !company) { showToast("Add a role and company."); return; }
  if (description.length < 20 && url && state.api) description = await fetchPostingText(url);
  if (description.length < 20) { showToast("Add at least 20 characters of job detail."); return; }

  if (state.api) {
    const payload = await apiJson("/api/jobs/analyze", { method: "POST", body: { title, company, url, description } });
    state.jobs = payload.jobs;
    renderAnalysis(payload.job, payload.analysis);
  } else {
    const analysis = analyzeJob({ title, company, description });
    const job = makeLocalJob({ title, company, url, description, analysis });
    state.jobs = [job, ...state.jobs.filter((item) => item.source !== "sample")];
    saveJson(STORAGE.jobs, state.jobs);
    renderAnalysis(job, analysis);
  }
  render();
  showToast(state.api ? "Job analyzed and saved on the server." : "Job analyzed and saved locally.");
}

async function fetchPosting() {
  const url = $("#job-url").value.trim();
  if (!url) { showToast("Add a job URL first."); return; }
  if (!state.api) { showToast("URL fetch needs the Node server. Run node server.js."); return; }
  try {
    const text = await fetchPostingText(url);
    $("#job-description").value = text;
    showToast("Posting fetched. Review the text, then analyze.");
  } catch (error) {
    showToast(error.message || "Could not fetch posting.");
  }
}

async function fetchPostingText(url) {
  const payload = await apiJson("/api/fetch-job", { method: "POST", body: { url } });
  return payload.text || "";
}

async function saveProfile(event) {
  event.preventDefault();
  state.profile = { roles: $("#target-roles").value.trim(), skills: $("#core-skills").value.trim(), dealbreakers: $("#dealbreakers").value.trim() };
  if (state.api) await apiJson("/api/profile", { method: "PUT", body: state.profile });
  else saveJson(STORAGE.profile, state.profile);
  renderReadiness();
  showToast(state.api ? "Profile saved on server." : "Profile saved locally.");
}

async function resetData() {
  if (!confirm("Reset JobFlow profile and tracker data?")) return;
  const jobsToDelete = userJobs().map((job) => job.id);
  state.profile = { roles: "", skills: "", dealbreakers: "" };
  state.jobs = [];
  if (state.api) {
    await apiJson("/api/profile", { method: "PUT", body: state.profile });
    for (const id of jobsToDelete) await apiJson(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
  } else {
    saveJson(STORAGE.profile, state.profile);
    saveJson(STORAGE.jobs, state.jobs);
  }
  hydrateProfileForm();
  render();
  showToast("Data reset.");
}

function hydrateProfileForm() {
  $("#target-roles").value = state.profile.roles || "";
  $("#core-skills").value = state.profile.skills || "";
  $("#dealbreakers").value = state.profile.dealbreakers || "";
}

function showMode() {
  $("#mode-copy").textContent = state.api ? "Server mode: applications persist in .jobflow/data.json and URLs can be fetched." : "Static mode: data stays in this browser only. Run node server.js for persistence and URL fetch.";
  $("#mode-pill").textContent = state.api ? "Live backend beta" : "Browser-only mode";
}

function render() { renderReadiness(); renderMetrics(); renderStatusOptions(); renderTracker(); renderActions(); }

function renderReadiness() {
  const inputs = [state.profile.roles, state.profile.skills, state.profile.dealbreakers].filter(Boolean);
  const skillCount = splitTerms(state.profile.skills).length;
  const score = inputs.length ? Math.min(96, Math.round(28 + inputs.length * 18 + skillCount * 5)) : 0;
  $("#readiness-score").textContent = `${score}%`;
  $("#readiness-copy").textContent = score >= 80 ? "Profile is strong enough for credible matching. Add achievements for sharper drafts." : "Add target roles, core skills, and deal-breakers to improve matching.";
}

function renderMetrics() {
  const realJobs = userJobs();
  const applied = realJobs.filter((job) => ["applied", "interview", "offer"].includes(normalizeStatus(job.status))).length;
  const analyzed = realJobs.filter((job) => Number(job.fit_rating) > 0).length;
  const saved = realJobs.filter((job) => normalizeStatus(job.status) === "saved").length;
  const average = realJobs.length ? Math.round(realJobs.reduce((sum, job) => sum + Number(job.fit_rating || 0), 0) / realJobs.length) : 0;
  $("#metric-saved").textContent = saved;
  $("#metric-analyzed").textContent = analyzed;
  $("#metric-applied").textContent = applied;
  $("#metric-fit").textContent = average ? `${average}%` : "—";
}

function renderStatusOptions() {
  const select = $("#status-filter");
  const current = select.value || state.filters.status;
  const statuses = [...new Set(state.jobs.map((job) => normalizeStatus(job.status)).filter(Boolean))].sort();
  select.innerHTML = `<option value="all">All statuses</option>${statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join("")}`;
  select.value = statuses.includes(current) ? current : "all";
  state.filters.status = select.value;
}

function renderTracker() {
  const list = $("#tracker-list");
  const jobs = state.jobs.filter((job) => {
    const statusOk = state.filters.status === "all" || normalizeStatus(job.status) === state.filters.status;
    const haystack = [job.company, job.role, job.sector, job.notes].filter(Boolean).join(" ").toLowerCase();
    return statusOk && haystack.includes(state.filters.query);
  });
  if (!jobs.length) { list.innerHTML = `<div class="empty-state">No matching applications yet. Analyze a job to start your pipeline.</div>`; return; }
  list.innerHTML = jobs.map((job) => `
    <article class="job-card">
      <div>
        <h3>${escapeHtml(job.role || "Untitled role")}</h3>
        <p>${escapeHtml(job.company || "Unknown company")} · ${escapeHtml(job.sector || "General")}${job.source === "sample" ? " · Sample" : ""}</p>
      </div>
      <div class="fit">${Number(job.fit_rating || 0)}% fit</div>
      <select class="status-select" data-status="${escapeHtml(job.id)}" ${job.source === "sample" ? "disabled title='Sample rows are replaced when you analyze a job'" : ""}>${statusSelectOptions(job.status)}</select>
      <div class="job-actions">
        ${documentLinks(job)}
        <button class="small-button danger-link" type="button" data-remove="${escapeHtml(job.id)}" ${job.source === "sample" ? "disabled title='Sample rows are replaced when you analyze a job'" : ""}>Remove</button>
      </div>
      <p>${escapeHtml(job.notes || "No notes yet.")}</p>
    </article>
  `).join("");
  list.querySelectorAll("[data-status]").forEach((select) => select.addEventListener("change", async () => {
    const job = state.jobs.find((item) => item.id === select.dataset.status);
    if (!job) return;
    job.status = select.value;
    if (state.api && job.source !== "sample") await apiJson(`/api/jobs/${encodeURIComponent(job.id)}/status`, { method: "PATCH", body: { status: select.value } });
    else saveJson(STORAGE.jobs, state.jobs);
    render();
    showToast("Status updated.");
  }));
  list.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", async () => {
    if (state.api) await apiJson(`/api/jobs/${encodeURIComponent(button.dataset.remove)}`, { method: "DELETE" });
    state.jobs = state.jobs.filter((job) => job.id !== button.dataset.remove);
    if (!state.api) saveJson(STORAGE.jobs, state.jobs);
    render();
    showToast("Application removed.");
  }));
}

function documentLinks(job) {
  if (!state.api || job.source === "sample") return "";
  const id = encodeURIComponent(job.id);
  return `<a class="doc-link" href="/api/documents/${id}/cv.pdf">CV PDF</a><a class="doc-link" href="/api/documents/${id}/cover.pdf">Cover PDF</a>`;
}

function statusSelectOptions(current) {
  return ["saved", "analyzed", "applied", "interview", "offer", "rejected"].map((status) => `<option value="${status}" ${status === normalizeStatus(current) ? "selected" : ""}>${status}</option>`).join("");
}

function renderActions() {
  const actions = [];
  if (!state.api) actions.push("Run node server.js to enable server persistence, URL fetch, and PDF drafts.");
  if (!state.jobs.some((job) => job.source !== "sample")) actions.push("Analyze one real job to replace sample rows.");
  if (splitTerms(state.profile.skills).length < 5) actions.push("Add more skills with context to improve scoring.");
  const strong = userJobs().find((job) => Number(job.fit_rating) >= 80);
  if (strong) actions.push(`Create application materials for ${strong.role} at ${strong.company}.`);
  actions.push("Export CSV before moving devices or clearing browser data.");
  $("#action-list").innerHTML = actions.slice(0, 4).map((action) => `<li>${escapeHtml(action)}</li>`).join("");
}

function renderAnalysis(job, analysis) {
  const result = $("#analysis-result");
  result.className = "analysis-result";
  result.innerHTML = `
    <div class="result-grid">
      <div class="fit-badge"><div><strong>${analysis.score}%</strong><span>${escapeHtml(analysis.label)}</span></div></div>
      <div>
        <h3>${escapeHtml(job.role)} · ${escapeHtml(job.company)}</h3>
        <p>${escapeHtml(analysis.summary)}</p>
        <ul class="insight-list">${analysis.insights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        <div class="document-actions">${documentLinks(job)}</div>
      </div>
    </div>`;
}

function makeLocalJob({ title, company, url, description, analysis }) {
  return { id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `job-${Date.now()}-${Math.random().toString(36).slice(2)}`, date: new Date().toISOString().slice(0, 10), company, sector: inferSector(description), role: title, role_type: inferRoleType(title, description), channel: url ? "URL reference" : "Manual import", status: "analyzed", contact_person: "", fit_rating: String(analysis.score), notes: analysis.summary, cv_file: "", cover_letter_file: "", source: url || "local", description };
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, { method: options.method || "GET", headers: options.body ? { "Content-Type": "application/json" } : undefined, body: options.body ? JSON.stringify(options.body) : undefined, cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed: ${response.status}`);
  return payload;
}

function analyzeJob({ title, description }) {
  const skills = splitTerms(state.profile.skills).map((skill) => skill.toLowerCase());
  const text = `${title} ${description}`.toLowerCase();
  const matches = skills.filter((skill) => skill && phraseInText(text, skill));
  const roleMatch = splitTerms(state.profile.roles).some((role) => phraseInText(text, role.toLowerCase()) || phraseInText(text, role.toLowerCase().split(" ")[0]));
  const dealbreakerHits = detectDealbreakerHits(text, splitTerms(state.profile.dealbreakers));
  const score = clamp(48 + matches.length * 9 + (roleMatch ? 12 : 0) - dealbreakerHits.length * 10, 35, 94);
  const label = score >= 80 ? "Strong fit" : score >= 65 ? "Possible fit" : "Low fit";
  const insights = [matches.length ? `Matched skills: ${matches.slice(0, 5).join(", ")}.` : "No direct profile-skill matches found. Add more skills or review the job manually.", roleMatch ? "Role aligns with target titles." : "Role title is outside your saved target-role keywords.", dealbreakerHits.length ? `Potential deal-breakers: ${dealbreakerHits.join(", ")}.` : "No saved deal-breakers detected in the posting."];
  return { score, label, insights, summary: `${label}. Emphasize ${matches.slice(0, 3).join(", ") || "transferable achievements"} and address gaps before applying.` };
}

function parseCsv(text) { const rows = []; const lines = text.trim().split(/\r?\n/); if (lines.length < 2) return rows; const headers = splitCsvLine(lines[0]); for (const line of lines.slice(1)) { if (!line.trim()) continue; const values = splitCsvLine(line); rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]))); } return rows; }
function splitCsvLine(line) { const values = []; let current = ""; let quoted = false; for (let index = 0; index < line.length; index += 1) { const char = line[index]; const next = line[index + 1]; if (char === '"' && quoted && next === '"') { current += '"'; index += 1; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { values.push(current); current = ""; } else current += char; } values.push(current); return values; }
function toCsv(jobs) { const rows = jobs.filter((job) => job.source !== "sample").map((job) => CSV_HEADERS.map((header) => csvCell(job[header] || "")).join(",")); return [CSV_HEADERS.join(","), ...rows].join("\n"); }
function csvCell(value) { const text = String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function detectDealbreakerHits(text, terms) { return terms.filter((rawTerm) => { const term = rawTerm.toLowerCase().trim(); if (!term) return false; if (term.startsWith("no ")) { const constraint = term.slice(3).trim(); if (phraseInText(text, `no ${constraint} required`) || phraseInText(text, `${constraint} not required`)) return false; return [`${constraint} required`, `requires ${constraint}`, `must ${constraint}`, `must be willing to ${constraint}`, `willing to ${constraint}`].some((phrase) => phraseInText(text, phrase)); } return phraseInText(text, term); }); }
function inferSector(text) { const lower = text.toLowerCase(); if (/health|clinic|bio|medical/.test(lower)) return "Healthcare"; if (/finance|bank|investment|trading/.test(lower)) return "Finance"; if (/ai|software|data|platform|saas/.test(lower)) return "Technology"; return "General"; }
function inferRoleType(title, text) { const lower = `${title} ${text}`.toLowerCase(); if (/product/.test(lower)) return "Product"; if (/data|analyst|analytics|science/.test(lower)) return "Analytics"; if (/operation|ops/.test(lower)) return "Operations"; if (/engineer|developer/.test(lower)) return "Engineering"; return "General"; }
function setActiveNav(hash = location.hash || "#dashboard") { document.querySelectorAll(".nav-list a").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === hash)); }
function userJobs() { return state.jobs.filter((job) => job.source !== "sample"); }
function phraseInText(text, phrase) { return new RegExp(`(^|\\W)${escapeRegExp(phrase)}($|\\W)`, "i").test(text); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function normalizeStatus(status) { return String(status || "saved").trim().toLowerCase().replaceAll("_", " "); }
function splitTerms(value) { return String(value || "").split(/[,\n]/).map((term) => term.trim()).filter(Boolean); }
function clamp(number, min, max) { return Math.max(min, Math.min(max, number)); }
function loadJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function saveJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { console.warn("Local save failed", error); showToast("Could not save locally. Export your data before leaving."); } }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function download(filename, body, type) { const blob = new Blob([body], { type }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); showToast(`${filename} downloaded.`); }
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600); }
