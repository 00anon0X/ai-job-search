# JobFlow

A clean AI workspace for finding roles, scoring fit, and producing tailored application materials.

## What it does

- Builds a reusable candidate profile from your CV, LinkedIn export, diplomas, references, and past applications.
- Can use configured job-board integrations where available.
- Evaluates a posting before you spend time applying.
- Drafts tailored CVs, cover letters, and interview prep.
- Compiles and checks final PDFs so layout issues are caught before sending.

## Quick start

```bash
git clone <your-repo-url>
cd ai-job-search
```

Run the browser prototype:

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/dashboard/`. If that port is busy, use another one, for example `4174`.

The browser dashboard is a local prototype for profile inputs, deterministic fit scoring, tracking, and exports. The agent slash-command workflow handles deeper fit evaluation, document drafting, and PDF compilation.

Optional job-board tools, if present in `.agents/skills/`:

```bash
for tool in jobbank-search jobdanmark-search jobindex-search jobnet-search; do
  cd .agents/skills/$tool/cli && bun install && cd ../../../..
done
```

Start your agent in the repo, then run:

```text
/setup
```

Choose one onboarding path:

1. **Documents folder** — drop source material into `documents/` and let the assistant build your profile.
2. **Single CV import** — paste or attach one CV/resume.
3. **Interview mode** — answer structured questions from scratch.

## Daily workflow

```text
/setup                          # build or update your profile
/apply <job-url-or-description>  # evaluate fit, then draft documents
/expand                         # enrich profile details from linked sources
```

The apply flow evaluates fit first. If the role is worth pursuing, it drafts the CV and cover letter, reviews them, compiles PDFs, checks page layout, and returns the final files with a pass/fail checklist.

## Repository map

```text
CLAUDE.md                         profile + workflow rules
dashboard/                         browser prototype for analyzing jobs + tracking applications
.claude/commands/                 /setup, /apply, /expand, /reset
.claude/skills/                   application, search, and upskill playbooks
.agents/skills/                   job-board CLI integrations
cv/                               CV templates and generated CVs
cover_letters/                    cover letter template, fonts, and generated letters
documents/                        source material for profile setup
job_scraper/                      scraper state and results
upskill/                          skill-gap reports
salary_lookup.py                  optional salary benchmarking
job_search_tracker.csv            application tracker
```

## Requirements

- Python 3.10+
- Bun, only if using the included TypeScript job-board CLIs
- LaTeX with `lualatex` and `xelatex` for PDF generation
- An agent CLI that supports the slash-command workflow in `.claude/commands/`

## Optional salary data

If you have salary benchmarks, create `salary_data.json` in the repo root or convert an Excel file:

```bash
pip install openpyxl
python tools/convert_salary_excel.py path/to/salary-data.xlsx --source "Salary Data 2026"
```

If no salary data exists, the application workflow skips that step.

## Reset

```text
/reset profile     # clears profile files, keeps framework rules
/reset documents   # clears documents folder
/reset all         # clears both
```

Reset actions require explicit confirmation before anything is deleted.

## License

MIT. See `LICENSE`.
