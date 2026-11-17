# YEON OS Auto-Pilot (pastry-pilot#18, #20)

**Operating model (2026-11-17):** the owner does a one-time setup, then only makes feature requests
and important approvals. Auto-Pilot does development → tests → PR → migration → deploy → report.

Status: **Implemented in code, not verified end to end.** Workflows run once the setup below exists.
`YEON OS setup status` (Actions tab) shows what is actually configured.

## A. One-time setup (owner, once)

Run **Actions → YEON OS setup status → Run workflow** at any point to check these against the real
GitHub and Supabase state. It prints set/missing and HTTP codes only, never secret values.

| # | Where | What | Needed for |
| --- | --- | --- | --- |
| 1 | GitHub → Settings → Secrets → Actions | `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) or `ANTHROPIC_API_KEY` | Claude implements issues and reviews PRs |
| 2 | GitHub → Settings → Actions → General | *Read and write permissions* + *Allow GitHub Actions to create and approve pull requests* | Auto-Pilot opens draft PRs |
| 3 | GitHub → Secrets | `SUPABASE_ACCESS_TOKEN` (supabase.com → Account → Access tokens) | Edge function deploys |
| 4 | GitHub → Secrets | `SUPABASE_DB_URL` (Supabase → Connect → Session pooler URI, with the DB password) | Migrations |
| 5 | GitHub → Settings → Environments | Create `supabase-production` with **you as required reviewer**; create `supabase-auto` with no rules | High-risk DB/function changes wait for your one-click approval |
| 6 | Supabase → Edge Functions → Secrets, and GitHub → Secrets | The same random value as `DEV_BOARD_INGEST_TOKEN` in both | Workflows record progress on the Dev Board |
| 7 | GitHub → Variables (optional) | `APP_URL` = the signed-in PILOT address | Post-deploy smoke check |
| 8 | Supabase → Edge Functions → Secrets (optional) | `GITHUB_READ_TOKEN` (fine-grained, read-only Issues + PRs) | Dev Board sync of private repos |
| 9 | GitHub → Variables (**approval**) | `AUTOPILOT_AUTOMERGE` = `true` | Turns on auto-merge of low-risk PRs. Leave unset until you approve it |

Already in place before this change (secret *names* used by `deploy.yml`, values not checked):
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_PROJECT_ID`, `VITE_SUPABASE_*`. The setup-status run confirms they exist.

After items 3–6 exist, the first run of **Supabase deploy** applies the Development Board
migration. Because it changes RLS, the run waits for your approval in `supabase-production`. You no
longer run it in the SQL editor. It also deploys `dev-board-github-sync` and `dev-board-ingest`.

## B. What Auto-Pilot does after setup

1. **Issue → draft PR** (`yeon-autopilot.yml`). A writer adds the `yeon-auto` label, or ChatGPT
   creates the issue with it. Claude reads the canonical YEON OS docs and the code, implements the
   change on `autopilot/issue-N`, runs build/tests/lint, gets one fix attempt, and opens a draft PR
   with the real log.
   - It does not start when another open PR already refers to the issue, and allows at most 2 attempts.
   - It never edits `.github/` or env files.
2. **PR checks** (`pr-checks.yml`, every PR).
   - Build, tests (fails only on failures not in `tests/known-failures.txt`) and
     `scripts/lint-changed.sh` run, then a risk check labels the PR `autopilot:low-risk` or
     `autopilot:needs-human`.
   - Low-risk Auto-Pilot PRs get one Claude review (PASS/BLOCK).
3. **Merge.**
   - **Low risk:** merged automatically only when `AUTOPILOT_AUTOMERGE=true`, all checks and
     branch protection pass, and the review says PASS.
   - **High risk** (DB, auth, RLS, secrets, payments, CI, dependencies, cross-OS sync, large diffs):
     you merge it. That is your approval.
4. **Database and functions** (`supabase-deploy.yml`, after main changes).
   - `scripts/supabase-migrate.mjs` applies only *new* migration files. These are files after
     `supabase/automation-baseline.txt` that are neither in the Lovable history nor in the ledger
     `yeon_ops.migration_ledger`.
   - All pending files get one dry run that is rolled back. Then each file is applied in its own
     transaction with its ledger row, and the run stops at the first failure. Editing an applied
     migration is refused.
   - PILOT edge functions listed in `supabase/config.toml` deploy with their pinned `verify_jwt`.
     SHCS functions in the same project are never touched.
   - Low risk runs right away. High risk (RLS, grants, delete/update/drop, auth, SECURITY DEFINER,
     triggers, SHCS objects, new or secret-touching functions) waits for your approval, and is
     refused if `supabase-production` has no required reviewer.
5. **App deploy.** `deploy.yml` (unchanged) runs on push to main. After an Auto-Pilot merge it is
   started after the database step.
6. **Report.** `post-deploy-check.yml` checks `APP_URL` and records DEPLOYED or FAILED. Every stage
   records progress on the Dev Board item linked to the issue (`dev-board-ingest`). Nothing
   automatic ever sets **Verified**: that needs your runtime evidence.

State is kept in labels: `autopilot:running`, `pr-open`, `checks-passed/failed`, `low-risk`,
`needs-human`, `review-passed/blocked`, `merged`, `failed`, `blocked`, `attempt-1/2`.

## Limits

- Runs start only from a writer's `yeon-auto` label. The label is removed on start, and labels set
  by workflows start nothing.
- There is 1 fix attempt per run and 2 attempts per issue. `--max-turns` is 80 / 30 / 25, and
  timeouts are 60 / 20 minutes.
- Only one Auto-Pilot run per issue and one Supabase deploy at a time.

## Failure and recovery

- A migration that fails is rolled back as a whole, and the run stops. Files applied earlier in the
  same run stay applied (see the ledger). To undo one, review and run its file in `supabase/rollback/`.
- A function deploy that fails leaves the previous version live.
- An app deploy that fails keeps the previous Worker. Re-run *Deploy to Cloudflare Workers* after the fix.
- To switch everything off, unset `AUTOPILOT_AUTOMERGE`, remove the Claude secret, or disable the
  workflows in the Actions tab.

## Other OS repositories (checked 2026-11-17)

| Repo | CI today | Supabase | Plan |
| --- | --- | --- | --- |
| pastry-pilot | `deploy.yml` + this PR's workflows | `meswjzwxldhqkjglnmzt` (shared with SHCS) | Pilot. Dry run here first |
| shcs-order | No GitHub Actions. Deploy path unverified (Lovable or `wrangler.jsonc`) | Same project. Owns `shco-*` functions and 11 migrations | Proposed. Copy the workflows with its own baseline and function list. The ledger is keyed by repo |
| wann-planner | No GitHub Actions. Deploy path unverified | Separate project `txrxzsrjqwhvjosutotp`, 36 migrations | Proposed. Needs its own `SUPABASE_*` secrets |

## Dry run (to mark this Verified)

1. Finish setup A, then run *YEON OS setup status*. Every required item should read set/ok.
2. Approve the waiting *Supabase deploy* run. Check that the Dev Board opens with YOS-001..003.
3. Create the issue "Docs: add a CHANGELOG line for the Development Board" with the `yeon-auto` label.
4. Expect: draft PR → checks → `autopilot:low-risk` → review → (merge only if auto-merge is on) →
   deploy → post-deploy check → board updates. Record the run links in #20.
