import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  canonicalFormulaName,
  FORMULA_TEXTURES,
  readCanonicalFormulaName,
} from "@/lib/formula-name";
import { flavourFamiliesQuery, techniqueCategoriesQuery } from "@/lib/queries";
import { Field, inputClass, selectClass } from "./ui";

export function FormulaNameFields({
  initialName = "",
  onName,
}: {
  initialName?: string;
  onName: (name: string) => void;
}) {
  const initial = readCanonicalFormulaName(initialName);
  const [flavour, setFlavour] = useState(initial?.flavour ?? "");
  const [texture, setTexture] = useState(initial?.texture ?? "");
  const [productType, setProductType] = useState(initial?.productType ?? "");
  const flavours = useQuery(flavourFamiliesQuery());
  const techniques = useQuery(techniqueCategoriesQuery());
  const flavourList = useId();
  const typeList = useId();
  const name = canonicalFormulaName(flavour, texture, productType);

  return (
    <div className="space-y-2">
      <Field label="FLAVOUR">
        <input
          className={inputClass}
          list={flavourList}
          required
          value={flavour}
          onChange={(e) => {
            setFlavour(e.target.value);
            onName(canonicalFormulaName(e.target.value, texture, productType));
          }}
        />
        <datalist id={flavourList}>
          {flavours.data?.map((item) => (
            <option key={item.id} value={item.name_en || item.name} />
          ))}
        </datalist>
      </Field>
      <Field label="TEXTURE AT INTENDED USE">
        <select
          className={selectClass}
          required
          value={texture}
          onChange={(e) => {
            setTexture(e.target.value);
            onName(canonicalFormulaName(flavour, e.target.value, productType));
          }}
        >
          <option value="">Select texture</option>
          {FORMULA_TEXTURES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </Field>
      <Field label="PRODUCT TYPE">
        <input
          className={inputClass}
          list={typeList}
          required
          value={productType}
          onChange={(e) => {
            setProductType(e.target.value);
            onName(canonicalFormulaName(flavour, texture, e.target.value));
          }}
        />
        <datalist id={typeList}>
          {techniques.data?.map((item) => (
            <option key={item.id} value={item.name_en || item.name} />
          ))}
        </datalist>
      </Field>
      <output aria-live="polite" className="block text-sm font-medium">
        {name || "Flavour · Texture · Product Type"}
      </output>
      {!name && flavour && texture && productType && (
        <p className="text-xs text-destructive">
          Keep version numbers and dietary declarations in their separate fields.
        </p>
      )}
    </div>
  );
}
