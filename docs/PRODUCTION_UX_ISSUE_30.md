# Production UX · Issue 30

Use the canonical repository [QURIQURA/pastry-pilot](https://github.com/QURIQURA/pastry-pilot). The Cloudflare Worker retains its original name and URL. PILOT owns production plans and logs. SHCS owns customer orders and communication, and Wann Planner owns its calendar.

- A date without a start time lives on the formula selection as `planned_date`. Timed blocks take precedence. The Dashboard loads date-only selections into the selected day's weighing workspace and keeps them out of the unscheduled queue.
- A single unstarted block can return to a date-only plan via the existing Planner block removal path. The UI checks for existing production records before removing the block. Split and workflow blocks remain editable from the timeline.
- Production Orders can add the latest formula version at ×1 directly. The inline plan editor remains available for subsequent quantity changes.
- Actual timer start and finish stamp timezone-aware instants in the existing task record. The detail view renders those instants in Australia/Sydney. Timer writes compare the task revision, and a single task cannot start a second active timer from these controls. Planning blocks remain separate from actuals.
- Local SQL CI supplies minimal fixtures for historical tables because the deployment applier starts after the automation baseline. The SQL suite exercises setting and clearing the date through the applied schema.

Remaining before closing [#30](https://github.com/QURIQURA/pastry-pilot/issues/30): editable per-mould allocations and source-order verification; shared Cake and Pop-up detail layout; authenticated runtime testing of plan transitions and midnight timing; CI, deployment and authenticated smoke evidence for the final merge. Existing order and popup records remain in their own workflows.
