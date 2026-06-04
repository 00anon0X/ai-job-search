# Setup

Use this guide to get JobFlow ready for real applications.

## 1. Install prerequisites

### Agent CLI

Use an agent CLI that can read this repository and run the slash commands in `.claude/commands/`.

### Python

Python 3.10+ is required for salary lookup utilities:

```bash
python --version
```

### Bun

Bun is only needed for the included TypeScript job-board CLIs:

```bash
curl -fsSL https://bun.sh/install | bash
```

### LaTeX

Install a LaTeX distribution for PDF output:

- Windows: MiKTeX
- macOS: MacTeX
- Linux: `sudo apt install texlive-full` or `sudo dnf install texlive-scheme-full`

The CV flow uses `lualatex`. Cover letters use `xelatex` because the template depends on local fonts.

## 2. Clone the repo

```bash
git clone <your-repo-url>
cd ai-job-search
```

## 3. Install job-board tools

```bash
for tool in jobbank-search jobdanmark-search jobindex-search jobnet-search; do
  cd .agents/skills/$tool/cli && bun install && cd ../../../..
done
```

Skip this step if you only want profile setup and application drafting.

## 4. Build your profile

Start your agent in the repository, then run:

```text
/setup
```

Choose one path:

- **Documents folder:** add source material to `documents/` first, then let the assistant extract and cross-check your profile.
- **Single CV import:** paste or attach one resume/CV.
- **Interview mode:** answer structured questions section by section.

The setup flow fills the profile files, templates, interview examples, and search queries used by the rest of the app.

## 5. Add salary benchmarks (optional)

If you have salary data, create `salary_data.json` manually or convert an Excel file:

```bash
pip install openpyxl
python tools/convert_salary_excel.py path/to/salary-data.xlsx --source "Salary Data 2026"
```

If the file is missing, salary lookup is skipped.

## 6. Test the workflow

```text
/scrape
/apply <job-url-or-description>
```

The application flow:

1. evaluates fit,
2. drafts tailored documents,
3. reviews and revises them,
4. compiles PDFs,
5. checks page count and layout,
6. returns the final files with a verification checklist.

## Troubleshooting

### Job-board tools fail

Run `bun install` inside each CLI folder under `.agents/skills/*/cli`.

### LaTeX fails

- CVs compile with `lualatex`.
- Cover letters compile with `xelatex`.
- Make sure `moderncv` is installed.
- Keep the font files under `cover_letters/OpenFonts/fonts/`.

### Salary lookup is skipped

That is expected unless `salary_data.json` exists in the repo root.
