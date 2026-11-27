import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/datetime";
import { versionLabel, type FormulaVersion } from "@/lib/formula";
import { ingredientDisplayName } from "@/lib/pilot";
import {
  formulaVersionResearchEvidenceQuery,
  versionIngredientsQuery,
  type VersionIngredientRow,
} from "@/lib/queries";
import { alignIngredientOccurrences } from "@/lib/version-comparison-occurrences";
import { Field, SectionCard, StatusBadge, buttonClass, inputClass } from "./ui";

const fields = [
  ["version_title", "Version Title"],
  ["change_reason", "Reason for Change"],
  ["change_summary", "Changes"],
  ["target_improvement", "Target Improvement"],
  ["test_results", "Test Results"],
  ["observations", "Observations"],
  ["next_improvement", "Next Improvement"],
] as const;

type ResearchField = (typeof fields)[number][0];

function describeIngredient(row: VersionIngredientRow | undefined) {
  if (!row) return "—";
  const secondary =
    row.secondary_amount == null ? "" : ` · ${row.secondary_amount}${row.secondary_unit ?? ""}`;
  return `${row.amount}${row.unit}${secondary}${row.note ? ` · ${row.note}` : ""}`;
}

export function FormulaVersionResearch({
  version,
  versions,
}: {
  version: FormulaVersion;
  versions: FormulaVersion[];
}) {
  const queryClient = useQueryClient();
  const [edits, setEdits] = useState<Partial<Record<ResearchField, string>> | null>(null);
  const evidence = useQuery(formulaVersionResearchEvidenceQuery(version.id));
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (hash === "research-history") {
      document.getElementById(hash)?.scrollIntoView({ block: "start" });
    }
  }, [hash]);
  const comparisonVersion =
    evidence.data?.experiments.find((experiment) => experiment.base_version_id)?.base_version_id ??
    versions.filter((candidate) => candidate.version_number < version.version_number).at(-1)?.id ??
    null;
  const baseIngredients = useQuery(versionIngredientsQuery(comparisonVersion));
  const ingredients = useQuery(versionIngredientsQuery(version.id));
  const base = versions.find((candidate) => candidate.id === comparisonVersion);
  const changes =
    baseIngredients.isSuccess && ingredients.isSuccess && comparisonVersion
      ? alignIngredientOccurrences(
          [{ id: comparisonVersion }, version],
          [baseIngredients.data, ingredients.data],
        ).flatMap((entry) => {
          const before = entry.byVersion.get(comparisonVersion);
          const after = entry.byVersion.get(version.id);
          const previous = describeIngredient(before);
          const next = describeIngredient(after);
          const ingredient = (after ?? before)?.ingredients;
          return previous === next
            ? []
            : [
                {
                  id: entry.id,
                  name: ingredient ? ingredientDisplayName(ingredient) : "Ingredient",
                  previous,
                  next,
                },
              ];
        })
      : [];

  const save = useMutation({
    mutationFn: async (patch: Partial<Record<ResearchField, string>>) => {
      const update: Partial<Record<ResearchField, string | null>> = {};
      for (const [field] of fields) {
        const value = patch[field];
        if (value !== undefined) update[field] = value.trim() || null;
      }
      const { error } = await supabase
        .from("formula_versions")
        .update(update)
        .eq("id", version.id)
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["formula_versions", version.formula_id] });
      setEdits(null);
    },
  });

  return (
    <section id="research-history" className="scroll-mt-6">
      <SectionCard
        title={`${versionLabel(version.version_number)} R&D HISTORY`}
        action={
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              save.reset();
              setEdits({});
            }}
            disabled={edits !== null}
          >
            EDIT R&D
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
          <StatusBadge status={version.status} />
          <span>Created {formatDateTime(version.created_at)}</span>
          <span>Updated {formatDateTime(version.updated_at)}</span>
        </div>
        {edits !== null ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(edits);
            }}
          >
            {fields.map(([field, label]) => (
              <Field key={field} label={label}>
                <textarea
                  className={inputClass}
                  rows={field === "version_title" ? 1 : 2}
                  value={edits[field] ?? version[field] ?? ""}
                  onChange={(event) => setEdits({ ...edits, [field]: event.target.value })}
                  disabled={save.isPending}
                />
              </Field>
            ))}
            {save.isError && (
              <p role="alert" className="text-sm text-destructive">
                Could not save the R&D record. Try again.
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                className={buttonClass}
                disabled={save.isPending || Object.keys(edits).length === 0}
              >
                SAVE R&D
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={save.isPending}
                onClick={() => setEdits(null)}
              >
                CANCEL
              </button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            {fields.map(([field, label]) => (
              <div key={field}>
                <dt className="label-caps text-xs">{label}</dt>
                <dd className="whitespace-pre-wrap text-sm">
                  {version[field] || <span className="text-muted-foreground">Unrecorded</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {comparisonVersion && (
          <div className="mt-4">
            <h3 className="label-caps text-xs">
              INGREDIENT CHANGES{base ? ` FROM ${versionLabel(base.version_number)}` : ""}
            </h3>
            {baseIngredients.isError || ingredients.isError ? (
              <p className="text-sm text-destructive">Could not load ingredient changes.</p>
            ) : baseIngredients.isPending || ingredients.isPending ? (
              <p className="text-sm">Loading ingredient changes…</p>
            ) : changes.length ? (
              <ul className="divide-y divide-border text-sm">
                {changes.map((change) => (
                  <li key={change.id} className="py-1">
                    {change.name} · {change.previous} → {change.next}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No ingredient changes recorded.</p>
            )}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {evidence.isError && (
            <p role="alert" className="text-sm text-destructive">
              Could not load experiment and production records.
            </p>
          )}
          {evidence.isPending && (
            <p className="text-sm">Loading experiment and production records…</p>
          )}
          {evidence.data?.experiments.map((experiment) => (
            <div key={experiment.id} className="border-t border-border pt-2 text-sm">
              <h3 className="font-medium">
                {experiment.title} · {experiment.status}
              </h3>
              <p className="whitespace-pre-wrap">
                Hypothesis · {experiment.hypothesis || "Unrecorded"}
              </p>
              <p className="whitespace-pre-wrap">
                Result ·{" "}
                {experiment.result_notes ||
                  (experiment.result_height_mm == null ? "Unrecorded" : "")}{" "}
                {experiment.result_height_mm != null && `${experiment.result_height_mm} mm`}
              </p>
            </div>
          ))}
          {evidence.data?.observations.map((observation) => (
            <p key={observation.id} className="text-sm">
              <Link
                to="/production/$sessionId"
                params={{ sessionId: observation.work_session_id }}
                className="underline"
              >
                {observation.task_name}
              </Link>
              {" · "}
              {[
                observation.observation_status,
                observation.observation_height_start_mm != null &&
                  `Start ${observation.observation_height_start_mm} mm`,
                observation.observation_height_mid_mm != null &&
                  `Mid ${observation.observation_height_mid_mm} mm`,
                observation.observation_height_end_mm != null &&
                  `End ${observation.observation_height_end_mm} mm`,
                observation.observation_temperature_c != null &&
                  `${observation.observation_temperature_c}°C`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ))}
          <div>
            <h3 className="label-caps text-xs">LINKED ORDERS & WORK SESSIONS</h3>
            {evidence.data?.sessions.length === 0 && (
              <p className="text-sm text-muted-foreground">No linked work sessions.</p>
            )}
            <ul className="divide-y divide-border text-sm">
              {evidence.data?.sessions.map((session) => {
                const order = session.orders;
                return (
                  <li key={session.id} className="flex flex-wrap gap-2 py-1">
                    {order && (
                      <Link
                        to="/orders/$orderId"
                        params={{ orderId: order.id }}
                        className="underline"
                      >
                        {order.order_number}
                      </Link>
                    )}
                    <Link
                      to="/production/$sessionId"
                      params={{ sessionId: session.id }}
                      className="underline"
                    >
                      {session.name}
                    </Link>
                    <span className="text-muted-foreground">{session.status}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </SectionCard>
    </section>
  );
}
