import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  classifyFormulaForSlot,
  filterFormulaCandidates,
  hasLatestVersionDietaryTag,
} from "@/lib/formula-picker";
import {
  dietaryTagsQuery,
  formulasQuery,
  formulaVersionDietaryTagLinksQuery,
  techniqueCategoriesQuery,
} from "@/lib/queries";
import { inputClass, selectClass } from "./ui";

interface FormulaPickerProps {
  slot: string;
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  disabled?: boolean;
  fallbackLabel?: string;
}

export function FormulaPicker({
  slot,
  value,
  onChange,
  allowEmpty = true,
  disabled = false,
  fallbackLabel,
}: FormulaPickerProps) {
  const formulas = useQuery(formulasQuery());
  const techniques = useQuery(techniqueCategoriesQuery());
  const tags = useQuery(dietaryTagsQuery());
  const [tagId, setTagId] = useState("");
  const links = useQuery({ ...formulaVersionDietaryTagLinksQuery(), enabled: Boolean(tagId) });
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"compatible" | "unclassified" | "all">("compatible");
  const categories = techniques.data ?? [];
  const options = filterFormulaCandidates(
    formulas.data ?? [],
    categories,
    slot,
    value,
    search,
    scope,
  );
  const taggedOptions = tagId
    ? options.filter(
        (formula) =>
          formula.id === value ||
          hasLatestVersionDietaryTag(formula.formula_versions, links.data ?? [], tagId),
      )
    : options;
  const selected = formulas.data?.find((formula) => formula.id === value);
  const classification = selected && classifyFormulaForSlot(selected, categories, slot);
  const loading = formulas.isPending || techniques.isPending;

  return (
    <fieldset disabled={disabled} className="min-w-[12rem] flex-1 space-y-1">
      <div className="flex flex-wrap gap-1">
        <input
          aria-label={`${slot} recipe search`}
          className={`${inputClass} min-w-24 flex-1`}
          placeholder="Search recipes"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label={`${slot} recipe scope`}
          className={`${selectClass} !w-auto`}
          value={scope}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "compatible" || next === "unclassified" || next === "all") setScope(next);
          }}
        >
          <option value="compatible">Matching role</option>
          <option value="unclassified">Unclassified</option>
          <option value="all">Show all</option>
        </select>
        {Boolean(tags.data?.length) && (
          <select
            aria-label={`${slot} declared dietary tag on latest version`}
            className={`${selectClass} !w-auto`}
            value={tagId}
            onChange={(event) => setTagId(event.target.value)}
          >
            <option value="">Any dietary declaration</option>
            {tags.data?.map((tag) => (
              <option value={tag.id} key={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {tagId && links.isError && (
        <p role="status" className="text-xs text-destructive">
          Dietary declarations could not load.
        </p>
      )}
      <select
        aria-label={`${slot} recipe`}
        className={selectClass}
        value={value}
        disabled={loading || formulas.isError}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled={!allowEmpty}>
          {loading ? "Loading recipes…" : "— RECIPE —"}
        </option>
        {value && !selected && (
          <option value={value}>{fallbackLabel ?? `Linked recipe (${value})`}</option>
        )}
        {taggedOptions.map((formula) => (
          <option key={formula.id} value={formula.id}>
            {formula.name}
            {formula.components?.name && formula.components.name !== formula.name
              ? ` — ${formula.components.name}`
              : ""}
          </option>
        ))}
      </select>
      {formulas.isError || techniques.isError ? (
        <p role="status" className="text-xs text-destructive">
          Recipe classification could not load.
        </p>
      ) : !loading && classification === "different" ? (
        <p role="status" className="text-xs text-destructive">
          Linked recipe is classified for a different role.
        </p>
      ) : !loading && classification === "unclassified" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Linked recipe has no role classification.
        </p>
      ) : null}
    </fieldset>
  );
}
