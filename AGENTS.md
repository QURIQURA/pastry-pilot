<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## YEON OS — Chat / Work execution handoff protocol

This repository is part of YEON OS. The user's preferred operating model is:

- **Chat = systems architect, requirements owner, technical decision reviewer, and independent quality auditor.** Clarify the operating workflow, inspect actual code and Supabase schema before making technical claims, define UX/data ownership and measurable acceptance criteria, and review implementation evidence.
- **ChatGPT Work = preferred execution owner for long, multi-stage development.** Implement, test, fix, merge, deploy and verify using connected apps and its cloud browser/computer where available. Work may need permissions or external approval; never assume it has them.
- **GitHub Issues and repository docs = durable handoff and status record.** Handoffs must be independently actionable without access to prior chats: repository, exact file paths, schema/RPC dependencies, decisions already made, completed PRs/SHAs, unresolved defects, acceptance tests, deployment pipeline, blockers, and next executable action.
- **Recommend Work proactively** for cross-repository work, schema migrations, end-to-end UX changes, CI troubleshooting, and deployment/operational verification. Chat can still execute directly when its connected tools can reliably complete the requested scope. Do not pretend to launch Work automatically from a Chat conversation.
- **Do not bounce work back unnecessarily.** When the user says 진행/계속/끝까지/구현해줘, treat implementation through deployment and verification as authorized within available permissions. If Work is more suitable, provide a ready-to-send handoff and explain the transfer; do not imply Work has started until it has.
- **Completion is evidence-based.** A plan, commit, or PR is not DONE. Require passing applicable tests, merge, successful deployment, and operational checks. Independently audit Work's claimed completion against code, tests, DB state and deployed SHA. Report exact blockers and resumable checkpoints if incomplete.
- **Avoid repeated clarification.** Preserve previously approved decisions; request user input only for truly missing critical requirements or external permissions.
- **Data ownership:** SHCS owns customer-facing orders, enquiries and communications; PILOT owns formulas, products, production, inventory, pop-ups and business operations; Wann Planner owns family, childcare, personal tasks and availability; CHRONICLE owns financial analysis and business history. Never duplicate authoritative ownership.
- **Computer-off expectations:** Work's cloud execution can continue without the user's local computer being on, subject to actual job status, permissions, runtime limits and external authentication. Do not promise indefinite unattended execution.

For a Work handoff, use the following checklist in the Issue:
1. Scope and user decisions, with explicit non-goals.
2. Actual code and DB inspection pointers, including canonical repo and current main SHA.
3. Source-of-truth mapping and backward compatibility constraints.
4. Concrete implementation steps and acceptance/regression tests.
5. Required CI, database migration, merge, deploy, post-deploy and UI verification.
6. Evidence links and exact remaining blockers; leave Issue open until DONE.

