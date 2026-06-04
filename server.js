const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, ".jobflow");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY = 1_000_000;
const CSV_HEADERS = ["date", "company", "sector", "role", "role_type", "channel", "status", "contact_person", "fit_rating", "notes", "cv_file", "cover_letter_file", "source"];
const DEFAULT_PROFILE = {
  roles: "Product analyst, operations lead, data scientist",
  skills: "analytics, automation, stakeholder management, Python, product thinking",
  dealbreakers: "No relocation, unclear compensation, heavy travel"
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8"
};

ensureDataFile();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname === "/health") return json(res, 200, { ok: true, service: "jobflow", persistence: "file", dataFile: ".jobflow/data.json" });
    if (url.pathname === "/api/state" && req.method === "GET") return json(res, 200, readState());
    if (url.pathname === "/api/profile" && req.method === "PUT") return updateProfile(req, res);
    if (url.pathname === "/api/jobs/analyze" && req.method === "POST") return analyzeAndSave(req, res);
    if (url.pathname === "/api/fetch-job" && req.method === "POST") return fetchJob(req, res);
    if (url.pathname === "/api/export.csv" && req.method === "GET") return send(res, 200, toCsv(userJobs(readState().jobs)), "text/csv; charset=utf-8", { "Content-Disposition": "attachment; filename=jobflow-tracker.csv" });

    const statusMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/status$/);
    if (statusMatch && req.method === "PATCH") return updateStatus(req, res, statusMatch[1]);
    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch && req.method === "DELETE") return deleteJob(res, jobMatch[1]);
    const docMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/(cv|cover)\.(pdf|md|html)$/);
    if (docMatch && req.method === "GET") return sendDocument(res, docMatch[1], docMatch[2], docMatch[3]);

    return serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`JobFlow server listening on http://${HOST}:${PORT}`);
});

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ profile: DEFAULT_PROFILE, jobs: [] }, null, 2));
  }
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return { profile: { ...DEFAULT_PROFILE, ...(parsed.profile || {}) }, jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
  } catch {
    return { profile: DEFAULT_PROFILE, jobs: [] };
  }
}

function writeState(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ profile: state.profile || DEFAULT_PROFILE, jobs: state.jobs || [] }, null, 2));
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new Error("Request body too large");
  }
  return body ? JSON.parse(body) : {};
}

async function updateProfile(req, res) {
  const body = await readBody(req);
  const state = readState();
  state.profile = {
    roles: clean(body.roles),
    skills: clean(body.skills),
    dealbreakers: clean(body.dealbreakers)
  };
  writeState(state);
  return json(res, 200, { profile: state.profile });
}

async function analyzeAndSave(req, res) {
  const body = await readBody(req);
  const state = readState();
  let description = clean(body.description);
  const url = clean(body.url);
  if (description.length < 20 && url) {
    const fetched = await fetchText(url);
    description = fetched.text;
  }
  const title = clean(body.title);
  const company = clean(body.company);
  if (!title || !company || description.length < 20) return json(res, 400, { error: "Role, company, and at least 20 characters of job detail are required." });
  const analysis = analyzeJob({ title, company, description }, state.profile);
  const job = {
    id: newId(),
    date: new Date().toISOString().slice(0, 10),
    company,
    sector: inferSector(description),
    role: title,
    role_type: inferRoleType(title, description),
    channel: url ? "Fetched URL" : "Manual import",
    status: "analyzed",
    contact_person: "",
    fit_rating: String(analysis.score),
    notes: analysis.summary,
    cv_file: `/api/documents/${encodeURIComponent(titleId(company, title))}/cv.pdf`,
    cover_letter_file: `/api/documents/${encodeURIComponent(titleId(company, title))}/cover.pdf`,
    source: url || "server",
    description
  };
  job.id = titleId(company, title, job.id);
  job.cv_file = `/api/documents/${encodeURIComponent(job.id)}/cv.pdf`;
  job.cover_letter_file = `/api/documents/${encodeURIComponent(job.id)}/cover.pdf`;
  state.jobs = [job, ...state.jobs.filter((item) => item.source !== "sample")];
  writeState(state);
  return json(res, 200, { job, analysis, jobs: state.jobs });
}

async function fetchJob(req, res) {
  const body = await readBody(req);
  const url = clean(body.url);
  if (!/^https?:\/\//i.test(url)) return json(res, 400, { error: "Use a valid http(s) job URL." });
  const fetched = await fetchText(url);
  return json(res, 200, fetched);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "JobFlow/0.1 (+https://github.com/00anon0X/ai-job-search)" } });
    if (!response.ok) throw new Error(`Fetch failed with ${response.status}`);
    const html = await response.text();
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000);
    if (text.length < 80) throw new Error("Fetched page did not contain enough readable text.");
    return { url, title: cleanText(title), text };
  } finally {
    clearTimeout(timer);
  }
}

async function updateStatus(req, res, id) {
  const body = await readBody(req);
  const state = readState();
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return json(res, 404, { error: "Job not found" });
  job.status = normalizeStatus(body.status);
  writeState(state);
  return json(res, 200, { job, jobs: state.jobs });
}

function deleteJob(res, id) {
  const state = readState();
  state.jobs = state.jobs.filter((item) => item.id !== id);
  writeState(state);
  return json(res, 200, { jobs: state.jobs });
}

function sendDocument(res, id, kind, format) {
  const state = readState();
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return json(res, 404, { error: "Job not found" });
  const doc = kind === "cv" ? buildCv(job, state.profile) : buildCover(job, state.profile);
  const basename = safeName(`${job.company}-${job.role}-${kind}`);
  if (format === "md") return send(res, 200, doc.markdown, "text/markdown; charset=utf-8", { "Content-Disposition": `attachment; filename=${basename}.md` });
  if (format === "html") return send(res, 200, doc.html, "text/html; charset=utf-8", { "Content-Disposition": `attachment; filename=${basename}.html` });
  return send(res, 200, simplePdf(doc.lines), "application/pdf", { "Content-Disposition": `attachment; filename=${basename}.pdf` });
}

function buildCv(job, profile) {
  const skills = splitTerms(profile.skills).slice(0, 8);
  const roles = splitTerms(profile.roles).slice(0, 4);
  const lines = [
    "Tailored CV Draft",
    `Target: ${job.role} at ${job.company}`,
    "",
    "Profile",
    `Candidate positioned for ${job.role} with emphasis on ${skills.slice(0, 4).join(", ") || "relevant achievements"}.`,
    "",
    "Target Roles",
    roles.join(", ") || "Add target roles in JobFlow profile.",
    "",
    "Relevant Skills",
    skills.join(", ") || "Add core skills in JobFlow profile.",
    "",
    "Application Notes",
    job.notes || "Review the role and add quantified achievements before sending."
  ];
  return documentPayload(lines, `${job.role} CV draft`);
}

function buildCover(job, profile) {
  const skills = splitTerms(profile.skills).slice(0, 4).join(", ") || "relevant experience";
  const lines = [
    "Cover Letter Draft",
    `Dear ${job.company} hiring team,`,
    "",
    `I am interested in the ${job.role} role at ${job.company}. My background aligns with this opportunity through ${skills}.`,
    "",
    `Based on the fit analysis, I would emphasize: ${job.notes || "clear achievements and role-specific motivation"}`,
    "",
    "I would welcome the chance to discuss how I can contribute to the team.",
    "",
    "Sincerely,",
    "[Your name]"
  ];
  return documentPayload(lines, `${job.role} cover letter draft`);
}

function documentPayload(lines, title) {
  const markdown = lines.map((line, index) => index === 0 ? `# ${line}` : line).join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Inter,Arial,sans-serif;max-width:760px;margin:48px auto;line-height:1.55;color:#191713}h1{font-size:32px}</style></head><body>${lines.map((line, index) => index === 0 ? `<h1>${escapeHtml(line)}</h1>` : line ? `<p>${escapeHtml(line)}</p>` : `<br>`).join("")}</body></html>`;
  return { lines, markdown, html };
}

function simplePdf(lines) {
  const content = ["BT", "/F1 18 Tf", "72 760 Td", `(${pdfEscape(lines[0] || "JobFlow document")}) Tj`, "/F1 11 Tf"];
  let y = 0;
  for (const line of lines.slice(1)) {
    y -= 18;
    content.push(`0 ${y} Td`, `(${pdfEscape(line || " ")}) Tj`);
  }
  content.push("ET");
  const stream = content.join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) { offsets.push(Buffer.byteLength(pdf)); pdf += obj; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

function serveStatic(requestPath, res) {
  let pathname = requestPath === "/" ? "/dashboard/index.html" : requestPath;
  if (pathname.endsWith("/")) pathname += "index.html";
  const decoded = decodeURIComponent(pathname);
  const filePath = path.normalize(path.join(ROOT, decoded));
  if (!filePath.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  fs.readFile(filePath, (error, data) => {
    if (error) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    send(res, 200, data, MIME[path.extname(filePath)] || "application/octet-stream");
  });
}

function send(res, status, body, type, headers = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(body);
}
function json(res, status, payload) { send(res, status, JSON.stringify(payload), "application/json; charset=utf-8"); }
function userJobs(jobs) { return jobs.filter((job) => job.source !== "sample"); }
function clean(value) { return String(value || "").trim(); }
function cleanText(value) { return clean(value).replace(/\s+/g, " "); }
function newId() { return `job-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function titleId(company, title, fallback = newId()) { return safeName(`${company}-${title}`) || fallback; }
function safeName(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80); }
function normalizeStatus(status) { return String(status || "saved").trim().toLowerCase().replaceAll("_", " "); }
function splitTerms(value) { return String(value || "").split(/[,\n]/).map((term) => term.trim()).filter(Boolean); }
function phraseInText(text, phrase) { return new RegExp(`(^|\\W)${escapeRegExp(phrase)}($|\\W)`, "i").test(text); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
function pdfEscape(value) { return String(value).replace(/[\\()]/g, "\\$&").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ""); }
function clamp(number, min, max) { return Math.max(min, Math.min(max, number)); }

function analyzeJob({ title, description }, profile) {
  const skills = splitTerms(profile.skills).map((skill) => skill.toLowerCase());
  const text = `${title} ${description}`.toLowerCase();
  const matches = skills.filter((skill) => skill && phraseInText(text, skill));
  const roleMatch = splitTerms(profile.roles).some((role) => phraseInText(text, role.toLowerCase()) || phraseInText(text, role.toLowerCase().split(" ")[0]));
  const dealbreakerHits = detectDealbreakerHits(text, splitTerms(profile.dealbreakers));
  const score = clamp(48 + matches.length * 9 + (roleMatch ? 12 : 0) - dealbreakerHits.length * 10, 35, 94);
  const label = score >= 80 ? "Strong fit" : score >= 65 ? "Possible fit" : "Low fit";
  const insights = [
    matches.length ? `Matched skills: ${matches.slice(0, 5).join(", ")}.` : "No direct profile-skill matches found. Add more skills or review the job manually.",
    roleMatch ? "Role aligns with target titles." : "Role title is outside your saved target-role keywords.",
    dealbreakerHits.length ? `Potential deal-breakers: ${dealbreakerHits.join(", ")}.` : "No saved deal-breakers detected in the posting."
  ];
  return { score, label, insights, summary: `${label}. Emphasize ${matches.slice(0, 3).join(", ") || "transferable achievements"} and address gaps before applying.` };
}

function detectDealbreakerHits(text, terms) {
  return terms.filter((rawTerm) => {
    const term = rawTerm.toLowerCase().trim();
    if (!term) return false;
    if (term.startsWith("no ")) {
      const constraint = term.slice(3).trim();
      if (phraseInText(text, `no ${constraint} required`) || phraseInText(text, `${constraint} not required`)) return false;
      return [`${constraint} required`, `requires ${constraint}`, `must ${constraint}`, `must be willing to ${constraint}`, `willing to ${constraint}`].some((phrase) => phraseInText(text, phrase));
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
function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function toCsv(jobs) {
  const rows = jobs.map((job) => CSV_HEADERS.map((header) => csvCell(job[header] || "")).join(","));
  return [CSV_HEADERS.join(","), ...rows].join("\n");
}
