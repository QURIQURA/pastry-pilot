# Formula version R&D history

Component and Formula comparison headers link to `/formulas/{formulaId}?version={versionId}#research-history`. The URL selects a formula version by UUID. A change in version selection does not promote a draft or move production to a different recipe.

## Writing research metadata

The UI and database integrations write the same nullable text columns on `public.formula_versions`.

| Column | Content |
| --- | --- |
| `version_title` | Short title for this version |
| `change_reason` | Observed problem or reason for revising the preceding version |
| `change_summary` | Changes to ingredients, ratios, or method |
| `target_improvement` | Expected effect or success criterion |
| `test_results` | Confirmed test outcome |
| `observations` | Recorded notes on texture, taste, stability, or storage |
| `next_improvement` | Proposed follow-up |

When creating a version through the database, pass known fields in the same insert as the new version. Leave unknown fields null. Keep recipe and method notes in `notes`, and use `formula_experiments` for experiment hypotheses, measurements, and decisions. The detail page reads experiments by their trial version UUID and production records by the saved formula version UUID. Popup orders resolve from the session UUID in the existing popup plan.

## Production verification for issue #86

Open the White Chocolate Cream Cheese Chantilly Component comparison and follow V1 and V2. Verify the selected version in the formula toolbar, each version's dates and status, and the distinct hot and cold cream lines. V1 was CURRENT and linked to SH-0016 in the pre-deploy check. V2 was TESTING, with saved version references in SH-0020 and the Saturday Night Dessert Gingerbread Cake session. Check both links and check that an empty result displays as unrecorded. The ingredient comparison uses the recorded experiment base when available, and otherwise uses the previous numbered version.
