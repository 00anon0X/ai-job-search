# JobFlow

A clean AI workspace for finding roles, scoring fit, and producing tailored application materials.

## What it does

- Builds a reusable candidate profile from your CV, LinkedIn export, diplomas, references, and past applications.
- Searches configured job boards and ranks matches by fit.
- Evaluates a posting before you spend time applying.
- Drafts tailored CVs, cover letters, and interview prep.
- Compiles and checks final PDFs so layout issues are caught before sending.

## Quick start

```bash
git clone <your-repo-url>
cd ai-job-search
```

Install the optional job-board tools:

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
/scrape                         # find and rank roles
/apply <job-url-or-description>  # evaluate fit, then draft documents
/upskill <job-url-or-description> # identify gaps and learning priorities
```

The apply flow evaluates fit first. If the role is worth pursuing, it drafts the CV and cover letter, reviews them, compiles PDFs, checks page layout, and returns the final files with a pass/fail checklist.

## Repository map

```text
CLAUDE.md                         profile + workflow rules
.claude/commands/                 /setup, /scrape, /apply, /expand, /upskill, /reset
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
