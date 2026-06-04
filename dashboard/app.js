const STORAGE = {
  profile: "jobflow.profile",
  jobs: "jobflow.jobs"
};

const CSV_HEADERS = [
  "date", "company", "sector", "role", "role_type", "channel", "status", "contact_person",
  "fit_rating", "notes", "cv_file", "cover_letter_file", "source"
];

const SAMPLE_JOBS = [
  {
    id: "sample-1",
    date: "2026-06-01",
    company: "Northstar Health",
    sector: "Healthcare",
    role: "Product Analyst",
    role_type: "Analytics",
    channel: "Manual import",
    status: "analyzed",
    contact_person: "",
    fit_rating: "86",
    notes: "Strong match on analytics, stakeholder work, and operational improvements.",
    cv_file: "",
    cover_letter_file: "",
    source: "sample"
  },
  {
    id: "sample-2",
    date: "2026-06-03",
    company: "Atlas Robotics",
    sector: "Automation",
    role: "Operations Lead",
    role_type: "Leadership",
    channel: "Saved role",
    status: "saved",
    contact_person: "",
    fit_rating: "74",
    notes: "Good operations fit; clarify people-management expectations before applying.",
    cv_file: "",
    cover_letter_file: "",
    source: "sample"
  }
];

const state = {
  jobs: [],
  profile: {
    roles: "Product analyst, operations lead, data scientist",
    skills: "analytics, automation, stakeholder management, Python, product thinking",
    dealbreakers: "No relocation, unclear compensation, heavy travel"
  },
  filters: { status: "all", query: "" }
};

const $ = (selector) => document.querySelector(selector);

init();

async function init() {
  state.profile = loadJson(STORAGE.profile, state.profile);
  state.jobs = loadJson(STORAGE.jobs, null) || await loadInitialJobs();
  bindEvents();
  hydrateProfileForm();
  render();
}

async function loadInitialJobs() {
  try {
    const response = await fetch("../job_search_tracker.csv");
    if (!response.ok) throw new Error(`CSV fetch failed: ${response.status}`);
    const rows = parseCsv(await response.text()).map((row, index) => ({
      id: `csv-${index + 1}`,
      ...row,
      fit_rating: row.fit_rating || "0"
    })).filter((row) => row.company || row.role);
    return rows.length ? rows : SAMPLE_JOBS;
  } catch (error) {
    console.warn("Using sample tracker data", error);
    return SAMPLE_JOBS;
  }
}

function bindEvents() {
  $("#job-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = $("#job-title").value.trim();
    const company = $("#job-company").value.trim();
    const url = $("#job-url").value.trim();
    const description = $("#job-description").value.trim();
    if (/^https?:\/\/\S+$/i.test(description)) {
      showToast("Paste the job description too; this prototype does not fetch URLs.");
      return;
    }
    if (!title || !company || description.length < 20) {
      showToast("Add a role, company, and at least 20 characters of job detail.");
      return;
    }
    const analysis = analyzeJob({ title, company, description });
    const job = {
      id: globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      date: new Date().toISOString().slice(0, 10),
      company,
      sector: inferSector(description),
      role: title,
      role_type: inferRoleType(title, description),
      channel: url ? "URL reference" : "Manual import",
      status: "analyzed",
      contact_person: "",
      fit_rating: String(analysis.score),
      notes: analysis.summary,
      cv_file: "",
      cover_letter_file: "",
      source: url || "local"
    };
    state.jobs = [job, ...state.jobs.filter((item) => item.source !== "sample")];
    saveJson(STORAGE.jobs, state.jobs);
    renderAnalysis(job, analysis);
    render();
    showToast("Job analyzed and added to tracker.");
  });

  $("#clear-form").addEventListener("click", () => {
    $("#job-form").reset();
    $("#analysis-result").className = "analysis-result empty";
    $("#analysis-result").textContent = "Add a job to see fit score, gaps, and recommended next action.";
  });

  $("#profile-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.profile = {
      roles: $("#target-roles").value.trim(),
      skills: $("#core-skills").value.trim(),
      dealbreakers: $("#dealbreakers").value.trim()
    };
    saveJson(STORAGE.profile, state.profile);
    renderReadiness();
    showToast("Profile saved locally.");
  });

  $("#status-filter").addEventListener("change", (event) => {
    state.filters.status = event.target.value;
    renderTracker();
  });
  $("#search-input").addEventListener("input", (event) => {
    state.filters.query = event.target.value.trim().toLowerCase();
    renderTracker();
  });
  $("#export-json").addEventListener("click", () => download("jobflow-export.json", JSON.stringify({ profile: state.profile, jobs: userJobs() }, null, 2), "application/json"));
  $("#export-csv").addEventListener("click", () => download("jobflow-tracker.csv", toCsv(userJobs()), "text/csv"));
  document.querySelectorAll(".nav-list a, .hero-actions a").forEach((link) => {
    link.addEventListener("click", () => setActiveNav(link.getAttribute("href")));
  });
  window.addEventListener("hashchange", () => setActiveNav());
  setActiveNav();

  $("#reset-data").addEventListener("click", () => {
    if (!confirm("Reset local JobFlow profile and tracker data?")) return;
    state.profile = { roles: "", skills: "", dealbreakers: "" };
    state.jobs = [];
    saveJson(STORAGE.profile, state.profile);
    saveJson(STORAGE.jobs, state.jobs);
    hydrateProfileForm();
    render();
    showToast("Local data reset.");
  });
}

function hydrateProfileForm() {
  $("#target-roles").value = state.profile.roles || "";
  $("#core-skills").value = state.profile.skills || "";
  $("#dealbreakers").value = state.profile.dealbreakers || "";
}

function render() {
  renderReadiness();
  renderMetrics();
  renderStatusOptions();
  renderTracker();
  renderActions();
}

function renderReadiness() {
  const inputs = [state.profile.roles, state.profile.skills, state.profile.dealbreakers].filter(Boolean);
  const skillCount = splitTerms(state.profile.skills).length;
  const score = inputs.length ? Math.min(96, Math.round(28 + inputs.length * 18 + skillCount * 5)) : 0;
  $("#readiness-score").textContent = `${score}%`;
  $("#readiness-copy").textContent = score >= 80
    ? "Profile is strong enough for credible matching. Add achievements for sharper drafts."
    : "Add target roles, core skills, and deal-breakers to improve matching.";
}

function renderMetrics() {
  const realJobs = userJobs();
  const applied = realJobs.filter((job) => ["applied", "interview", "offer"].includes(normalizeStatus(job.status))).length;
  const analyzed = realJobs.filter((job) => Number(job.fit_rating) > 0).length;
  const saved = realJobs.filter((job) => normalizeStatus(job.status) === "saved").length;
  const average = realJobs.length
    ? Math.round(realJobs.reduce((sum, job) => sum + Number(job.fit_rating || 0), 0) / realJobs.length)
    : 0;
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
  if (!jobs.length) {
    list.innerHTML = `<div class="empty-state">No matching applications yet. Analyze a job to start your pipeline.</div>`;
    return;
  }
  list.innerHTML = jobs.map((job) => `
    <article class="job-card">
      <div>
        <h3>${escapeHtml(job.role || "Untitled role")}</h3>
        <p>${escapeHtml(job.company || "Unknown company")} · ${escapeHtml(job.sector || "General")}${job.source === "sample" ? " · Sample" : ""}</p>
      </div>
      <div class="fit">${Number(job.fit_rating || 0)}% fit</div>
      <select class="status-select" data-status="${escapeHtml(job.id)}" ${job.source === "sample" ? "disabled title='Sample rows are replaced when you analyze a job'" : ""}>${statusSelectOptions(job.status)}</select>
      <button class="small-button" type="button" data-remove="${escapeHtml(job.id)}" ${job.source === "sample" ? "disabled title='Sample rows are replaced when you analyze a job'" : ""}>Remove</button>
      <p>${escapeHtml(job.notes || "No notes yet.")}</p>
    </article>
  `).join("");
  list.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      const job = state.jobs.find((item) => item.id === select.dataset.status);
      if (!job) return;
      job.status = select.value;
      saveJson(STORAGE.jobs, state.jobs);
      render();
      showToast("Status updated.");
    });
  });
  list.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.jobs = state.jobs.filter((job) => job.id !== button.dataset.remove);
      saveJson(STORAGE.jobs, state.jobs);
      render();
      showToast("Application removed.");
    });
  });
}

function statusSelectOptions(current) {
  const statuses = ["saved", "analyzed", "applied", "interview", "offer", "rejected"];
  const normalized = normalizeStatus(current);
  return statuses.map((status) => `<option value="${status}" ${status === normalized ? "selected" : ""}>${status}</option>`).join("");
}

function renderActions() {
  const actions = [];
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
        <ul class="insight-list">
          ${analysis.insights.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>
    </div>
  `;
}

function analyzeJob({ title, description }) {
  const skills = splitTerms(state.profile.skills).map((skill) => skill.toLowerCase());
  const text = `${title} ${description}`.toLowerCase();
  const matches = skills.filter((skill) => skill && phraseInText(text, skill));
  const roleMatch = splitTerms(state.profile.roles).some((role) => phraseInText(text, role.toLowerCase()) || phraseInText(text, role.toLowerCase().split(" ")[0]));
  const dealbreakerHits = detectDealbreakerHits(text, splitTerms(state.profile.dealbreakers));
  const score = clamp(48 + matches.length * 9 + (roleMatch ? 12 : 0) - dealbreakerHits.length * 10, 35, 94);
  const label = score >= 80 ? "Strong fit" : score >= 65 ? "Possible fit" : "Low fit";
  const insights = [
    matches.length ? `Matched skills: ${matches.slice(0, 5).join(", ")}.` : "No direct profile-skill matches found. Add more skills or review the job manually.",
    roleMatch ? "Role aligns with target titles." : "Role title is outside your saved target-role keywords.",
    dealbreakerHits.length ? `Potential deal-breakers: ${dealbreakerHits.join(", ")}.` : "No saved deal-breakers detected in the posting."
  ];
  return {
    score,
    label,
    insights,
    summary: `${label}. Emphasize ${matches.slice(0, 3).join(", ") || "transferable achievements"} and address gaps before applying.`
  };
}

function parseCsv(text) {
  const rows = [];
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return rows;
  const headers = splitCsvLine(lines[0]);
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const values = splitCsvLine(line);
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
  }
  return rows;
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(current); current = ""; }
    else current += char;
  }
  values.push(current);
  return values;
}

function toCsv(jobs) {
  const rows = jobs.filter((job) => job.source !== "sample").map((job) => CSV_HEADERS.map((header) => csvCell(job[header] || "")).join(","));
  return [CSV_HEADERS.join(","), ...rows].join("\n");
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function detectDealbreakerHits(text, terms) {
  return terms.filter((rawTerm) => {
    const term = rawTerm.toLowerCase().trim();
    if (!term) return false;
    if (term.startsWith("no ")) {
      const constraint = term.slice(3).trim();
      if (phraseInText(text, `no ${constraint} required`) || phraseInText(text, `${constraint} not required`)) {
        return false;
      }
      return [
        `${constraint} required`,
        `requires ${constraint}`,
        `must ${constraint}`,
        `must be willing to ${constraint}`,
        `willing to ${constraint}`
      ].some((phrase) => phraseInText(text, phrase));
    }
    return phraseInText(text, term);
  });
}

function inferSector(text) {
  const lower = text.toLowerCase();
  if (/health|clinic|bio|medical/.test(lower)) return "Healthcare";
  if (/finance|bank|investment|trading/.test(lower)) return "Finance";
  if (/ai|software|data|platform|saas/.test(lower)) return "Technology";
  return "General";
}

function inferRoleType(title, text) {
  const lower = `${title} ${text}`.toLowerCase();
  if (/product/.test(lower)) return "Product";
  if (/data|analyst|analytics|science/.test(lower)) return "Analytics";
  if (/operation|ops/.test(lower)) return "Operations";
  if (/engineer|developer/.test(lower)) return "Engineering";
  return "General";
}

function setActiveNav(hash = location.hash || "#dashboard") {
  document.querySelectorAll(".nav-list a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === hash);
  });
}
function userJobs() { return state.jobs.filter((job) => job.source !== "sample"); }
function phraseInText(text, phrase) { return new RegExp(`(^|\\W)${escapeRegExp(phrase)}($|\\W)`, "i").test(text); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function normalizeStatus(status) { return String(status || "saved").trim().toLowerCase().replaceAll("_", " "); }
function splitTerms(value) { return String(value || "").split(/[,\n]/).map((term) => term.trim()).filter(Boolean); }
function clamp(number, min, max) { return Math.max(min, Math.min(max, number)); }
function loadJson(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("Local save failed", error);
    showToast("Could not save locally. Export your data before leaving.");
  }
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function download(filename, body, type) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`${filename} downloaded.`);
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}
