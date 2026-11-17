# YEON OS Auto-Pilot (pastry-pilot#18)

Status: **Implemented in code, not verified.** No live run has happened yet because it needs the
owner's Claude credentials (see setup). Pilot repository: `QURIQURA/pastry-pilot`. `shcs-order`
and `wann-planner` come later, after a successful dry run here.

## What happens

1. Someone with write access adds the label **`yeon-auto`** to an issue (or creates the issue with
   that label, e.g. when ChatGPT files it through your account). No other step is needed.
2. `.github/workflows/yeon-autopilot.yml`:
   - checks the person has write access, the issue is open, nothing is already running, and fewer
     than 2 attempts were made; otherwise it comments why and stops;
   - creates branch `autopilot/issue-N` from `main`, gives Claude the issue, the canonical YEON OS
     docs (`wann-planner`) and this repo's `AGENTS.md` / `YEON_OS.md`;
   - Claude implements, commits and writes the PR body (no push, no `.github/` edits, no live DB);
   - the workflow runs build + tests + lint. If they fail, Claude gets **one** fix attempt;
   - the workflow pushes and opens a **draft PR** with the real check log, then starts PR checks.
3. `.github/workflows/pr-checks.yml` runs on every PR (and on Auto-Pilot branches):
   - build, `node scripts/ci-tests.mjs` (fails only on test failures not already listed in
     `tests/known-failures.txt`), eslint on changed files;
   - `scripts/autopilot-risk.mjs` labels the change `autopilot:low-risk` or `autopilot:needs-human`
     with reasons. Anything touching `supabase/`, `.github/`, dependencies, auth, secrets, payments,
     cross-OS sync, RPC/edge calls, destructive SQL or >15 files / >400 added lines needs a person;
   - for low-risk PRs that passed, one Claude review writes PASS or BLOCK;
   - **merge happens only if** the repository variable `AUTOPILOT_AUTOMERGE` is `true` **and** checks
     passed **and** risk is low **and** review said PASS. It is off by default.
4. A merge made by the workflow does **not** start `deploy.yml` (GitHub does not start workflows from
   `GITHUB_TOKEN` pushes). Merged ≠ deployed ≠ verified. Run *Deploy to Cloudflare Workers* by hand
   when you want it live, then verify at runtime.

State is kept in labels (`autopilot:running`, `autopilot:pr-open`, `autopilot:checks-failed`,
`autopilot:failed`, `autopilot:blocked`, `autopilot:merged`, `autopilot:attempt-1/2`, …). The
PILOT Development Board shows these labels on linked issues/PRs after **Sync GitHub**.

## Loop and cost limits

- Starts only on the `yeon-auto` label event from a writer; the workflow removes the label when it
  starts, so it cannot re-trigger itself. Labels set by the workflow do not start workflows.
- Max 2 attempts per issue, 1 fix attempt per run, `--max-turns` 80 / 30 / 25, job timeout 60 min.
- One run per issue at a time (concurrency group). Reviews run once per checks run.

## One-time owner setup (needs your accounts)

1. **Claude credentials** — Settings → Secrets and variables → Actions → New repository secret:
   - `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token` on your computer, uses your Claude plan), **or**
   - `ANTHROPIC_API_KEY` (API billing).
2. **Let Actions open PRs** — Settings → Actions → General → Workflow permissions: choose
   *Read and write permissions* and tick *Allow GitHub Actions to create and approve pull requests*.
3. Optional: **auto-merge of low-risk PRs** — Settings → Secrets and variables → Actions → Variables:
   `AUTOPILOT_AUTOMERGE` = `true`. Leave unset to always merge by hand.
   Optional: `AUTOPILOT_REVIEW` = `false` to skip the automated review.
4. Optional: branch protection on `main` requiring the *PR checks / checks* job.
5. Optional for the Development Board's GitHub sync on private repos: Supabase → Edge Functions →
   Secrets: `GITHUB_READ_TOKEN` (fine-grained, read-only Issues + Pull requests). Public repos sync
   without it.

## Dry run (to mark this Verified)

1. Create an issue such as "Docs: add a line to CHANGELOG.md about the Development Board" with
   label `yeon-auto`.
2. Expect: `autopilot:running` → draft PR `autopilot/issue-N` with check log → PR checks comment →
   `autopilot:low-risk` + review PASS/BLOCK. With `AUTOPILOT_AUTOMERGE` unset nothing merges.
3. Record the run links in #18 and on the board item YOS-002.

## Rollback

Delete `.github/workflows/yeon-autopilot.yml` (and `pr-checks.yml` if unwanted) and remove the
secrets. No database objects are involved.
