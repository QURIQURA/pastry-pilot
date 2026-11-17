# YEON OS Auto-Pilot (pastry-pilot#18, #20)

**Operating model (2026-11-17):** the owner does a one-time setup, then only makes feature requests
and important approvals. Auto-Pilot does development → tests → PR → migration → deploy → report.

Status: **Implemented in code, not verified end to end.** Workflows run once the setup below exists.
`YEON OS setup status` (Actions tab) shows what is actually configured.

## A. One-time setup

Run **Actions → YEON OS setup status → Run workflow** to check everything below against the real
GitHub and Supabase state. It prints set/missing, HTTP codes and non-secret settings, never values.
Do not ask the owner again for anything marked done here; re-run the status check instead.

### Done (owner reported 2026-11-17; secret presence checked by the setup-status run)

| Item | Where it is used |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` (pastry-pilot, shcs-order, wann-planner) | Auto-Pilot implementation and review |
| `SUPABASE_ACCESS_TOKEN` (all three repos) | Migrations and Dev Board records through the Supabase Management API; edge function deploys |
| `SUPABASE_PROJECT_ID` (all three repos) | Target project. pastry-pilot refuses to deploy if it is not `meswjzwxldhqkjglnmzt` |
| GitHub Actions may create PRs (all three repos) | Auto-Pilot draft PRs |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `VITE_SUPABASE_*` (pastry-pilot, existing) | `deploy.yml` app build and deploy |

### Not needed (replaced by existing settings)

| Item | Why it is not needed |
| --- | --- |
| `SUPABASE_DB_URL` | SQL runs through the Management API with the existing `SUPABASE_ACCESS_TOKEN`, so no database password is stored in GitHub. It stays an optional override for local runs. |
| `DEV_BOARD_INGEST_TOKEN` | Workflows record progress with `yeon_ops.dev_board_record(...)` through the same Management API. The planned `dev-board-ingest` edge function was removed, so there is no extra public endpoint. |
| `APP_URL` | Defaults to `https://quriqura-kora-pilot.oompaya.workers.dev/`, the Worker name `deploy.yml` pins. Set the repository variable only if the address changes. |
| `supabase-auto` environment | GitHub creates it on first use. It has no rules and is used for low-risk deploys only. |

### Still needed (owner only, needs your GitHub admin login)

**`production` environment with you as required reviewer.** This is the approval gate for
high-risk database and edge function deploys. Until it exists, high-risk deploys are refused,
never run unprotected. Claude cannot create it because environment settings need a repository
admin.
1. Open https://github.com/QURIQURA/pastry-pilot/settings/environments/new
2. Name: `production`, then click **Configure environment**.
3. Tick **Required reviewers**, add `QURIQURA`, and leave **Prevent self-review** unticked,
   because you are the only reviewer.
4. Click **Save protection rules**.

### Approval decisions (not setup)

- `AUTOPILOT_AUTOMERGE` = `true` (https://github.com/QURIQURA/pastry-pilot/settings/variables/actions →
  **New repository variable**) turns on auto-merge of low-risk PRs. Off until you decide.
- Optional: branch protection on `main` requiring *PR checks / checks* and *PR checks / sql-tests*.

## B. What Auto-Pilot does after setup

1. **Issue → draft PR** (`yeon-autopilot.yml`). A writer adds the `yeon-auto` label, or ChatGPT
   creates the issue with it. Claude reads the canonical YEON OS docs and the code, implements the
   change on `autopilot/issue-N`, runs build/tests/lint, gets one fix attempt, and opens a draft PR
   with the real log.
   - It does not start when another open PR already refers to the issue, and allows at most 2 attempts.
   - It never edits `.github/` or env files.
2. **PR checks** (`pr-checks.yml`, every PR).
   - `sql-tests` applies new migrations on a throwaway Postgres with the real applier, twice, then
     runs `tests/dev-board-rls.sql`. No secrets are involved.
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
   - All pending files get one dry run on the live project that is rolled back. Then each file is applied in its own
     transaction with its ledger row, and the run stops at the first failure. Editing an applied
     migration is refused.
   - PILOT edge functions listed in `supabase/config.toml` deploy with their pinned `verify_jwt`.
     SHCS functions in the same project are never touched.
   - Low risk runs right away. High risk (RLS, grants, delete/update/drop, auth, SECURITY DEFINER,
     triggers, SHCS objects, new or secret-touching functions) waits for your approval in
     `production`, and is refused if `production` has no required reviewer.
   - **Shared SHCS + Pilot database.**
     - Every apply takes one Postgres advisory lock (`yeon_ops.migrations`), so runs from any
       repository never interleave.
     - The ledger is keyed by repository, so SHCS can use the same ledger later.
     - Versions Lovable already recorded are skipped.
     - Any PILOT migration that touches `shco_*` objects is high risk.
5. **App deploy.** `deploy.yml` (unchanged) runs on push to main. After an Auto-Pilot merge it is
   started after the database step.
6. **Report.** `post-deploy-check.yml` checks the app address and records DEPLOYED or FAILED.
   - Every stage records progress on the Dev Board item linked to the issue, through
     `yeon_ops.dev_board_record`. Nothing automatic ever sets **Verified**: that needs your runtime
     evidence.
   - Steps that hold the Supabase token run scripts from `main`, never from a branch Claude edited.
     Claude's own steps never receive the token.

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

1. Create the `production` environment (above). Run *YEON OS setup status*; every row should read set/ok.
2. Merge PR #19 (your approval). *Supabase deploy* then plans the 2 board migrations and the new
   `dev-board-github-sync` function as high risk and waits for your **Approve and deploy** in the run.
3. After approval, open `/dev-board` and check that YOS-001..003 exist and the run is noted on YOS-003.
4. Create the issue "Docs: add a CHANGELOG line for the Development Board" with the `yeon-auto`
   label. Expect a draft PR, checks, `autopilot:low-risk`, a review, a merge only if auto-merge
   is on, then deploy, the post-deploy check and board updates. Record the run links in #20.
