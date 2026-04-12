# Sprint 2 CI Lint — Cursor Execution Spec

**Scope:** ionrift-waterline pilot
**Agent:** Cursor
**Status:** ✅ Run #2 all-green — spec updated to reflect post-validation architecture.

---

## Files to Create / Modify

| Action   | Path (relative to repo root)                   |
|----------|------------------------------------------------|
| DONE     | `.github/workflows/ci.yml`                     |
| DONE     | `.eslintrc.json`                               |
| DONE     | `tools/scan_ai_comments.js`                    |
| NO TOUCH | `.github/workflows/release.yml`                |

> **AI Tone Scan architecture (post-validation fix):**
> `ionrift-devtools` is a private repo — the dual-checkout approach is not viable.
> The scanner lives at `tools/scan_ai_comments.js` as a local CI copy.
> Authoring source of truth remains `ionrift-devtools/scripts/scan_ai_comments.js`.
> When patterns change in devtools, copy to `tools/` in every consuming module
> and commit with: `"chore: sync AI tone scanner patterns"`

---

## Exact Shell Commands

### 1. Validate ESLint runs locally before pushing

```bash
# From modules/ionrift-waterline/
npm install --no-save eslint@9
npx eslint "scripts/**/*.js" --config .eslintrc.json --max-warnings 0
```

Expected: exit 0. If warnings fire, fix them before pushing.
Flag any `no-undef` errors on Foundry globals back to Antigravity — the globals list
in `.eslintrc.json` may need expanding.

### 2. Validate the inclusion scan locally

```bash
grep -rn --include="*.js" --include="*.html" \
  -E '\b(Male|Female|Sex|Gender)\b' scripts/ lang/ || echo "CLEAN"
```

Expected: `CLEAN` or no output.

### 3. Validate import integrity locally

```bash
node -e "
const fs = require('fs'), path = require('path');
const ROOT = path.resolve('scripts');
let failed = false;
function check(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { check(full); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const src = fs.readFileSync(full, 'utf8');
    const imports = [...src.matchAll(/(?:import|from)\s+['\"](\.[^'\"]+)['\"]/g)].map(m => m[1]);
    for (const imp of imports) {
      const resolved = path.resolve(path.dirname(full), imp);
      if (![resolved, resolved+'.js'].some(c => fs.existsSync(c))) {
        console.error('BROKEN: ' + path.relative(ROOT, full) + ' → ' + imp);
        failed = true;
      }
    }
  }
}
check(ROOT);
if (failed) process.exit(1);
console.log('OK');
"
```

Expected: `OK`

### 4. Commit and push

```bash
git add .eslintrc.json .github/workflows/ci.yml
git commit -m "ci: add lint and static analysis pipeline (Sprint 2)"
git push origin main
```

### 5. Observe the Actions run

- Go to GitHub → Actions tab for `ionrift-waterline`.
- Confirm all 5 jobs complete green: `ESLint`, `Inclusion Terminology Scan`,
  `Import Integrity Check`, `Case-Sensitivity Check`, `AI Tone Scan`.

---

## Fail Conditions

| Failure | Action |
|---------|--------|
| `no-undef` on a Foundry global not in the globals list | Add to `.eslintrc.json → globals`. Re-run. |
| `no-unused-vars` fires on a real export | Add `/* eslint-disable-next-line no-unused-vars */` with brief justification comment. |
| AI tone scan fails | Review flagged line. If false positive (e.g. legitimate word "certainly" in user-facing string), add `// eslint-disable-line` **only after** confirming with Antigravity — do not suppress silently. |
| Import integrity fails | The broken import must be fixed. Do not bypass this check. |
| Case-sensitivity fails | Fix the import casing to match the real filename. Linux is case-sensitive; Windows is not. The CI is authoritative. |
| `ai-tone-scan` job fails after devtools pattern changes | Copy `ionrift-devtools/scripts/scan_ai_comments.js` into `tools/scan_ai_comments.js`, adjust paths if needed, commit as `chore: sync AI tone scanner patterns`. |

---

## Notes

- `release.yml` triggers on tag pushes only. `ci.yml` triggers on push to `main` only.
  They do not interfere with each other.
- AI tone scan uses `tools/scan_ai_comments.js` in this repo (local CI copy). Authoring
  source remains `ionrift-devtools/scripts/scan_ai_comments.js`. Sync manually when
  patterns change; see the table above and the `ai-tone-scan` job comments in `ci.yml`.
- `--max-warnings 0` on ESLint means warnings are treated as errors in CI.
  Locally you can run with `--max-warnings 10` during active development.

---

*Spec version: Sprint 2 | Authored by Antigravity | 2026-04-12*
