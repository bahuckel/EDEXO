/**
 * Options → Notify me → Your own rules (owner, 2026-11-02): a name and up to six conditions on the body's scan, all of
 * which must hold. The whole list is saved on each change (shared/customBodyRules.ts checks it on the server); text and
 * numbers are saved when the field is left, so a half-typed value never lands.
 */
import { useState } from "react";
import {
  MAX_CONDS,
  MAX_RULES,
  RULE_FIELDS,
  RULE_OPS,
  ruleFieldDef,
  type CustomBodyRule,
  type RuleCondition,
  type RuleField,
} from "@shared/customBodyRules";

/** Text saved when the field is left or on Enter. */
function DraftText({
  value,
  onCommit,
  disabled,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    setDraft(null);
    if (draft.trim() && draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <input
      type="text"
      className={className}
      value={draft ?? value}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={40}
      onChange={(ev) => setDraft(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") commit();
        if (ev.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** A decimal number saved when the field is left; "0.05" stays 0.05. */
function DraftDecimal({ value, onCommit, disabled, ariaLabel }: { value: number; onCommit: (v: number) => void; disabled?: boolean; ariaLabel: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && Number.isFinite(n) && n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      step="any"
      className="options-rule__num"
      value={draft ?? String(value)}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(ev) => setDraft(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => {
        if (ev.key === "Enter") commit();
        if (ev.key === "Escape") setDraft(null);
      }}
    />
  );
}

/** A fresh condition on a field: its first operator and a value the field can take. */
function freshCond(field: RuleField): RuleCondition {
  const def = ruleFieldDef(field)!;
  const op = RULE_OPS[def.kind][0]!.key;
  if (def.kind === "number") return { field, op, value: 0 };
  if (def.kind === "text") return { field, op, value: field === "planetClass" ? "icy" : "none" };
  return { field, op };
}

function newId(rules: readonly CustomBodyRule[]): string {
  let n = rules.length + 1;
  while (rules.some((r) => r.id === `r${n}`)) n++;
  return `r${n}`;
}

export function CustomRulesEditor({
  rules,
  busy,
  onSave,
}: {
  rules: readonly CustomBodyRule[];
  busy: boolean;
  onSave: (next: CustomBodyRule[]) => void;
}) {
  const setRule = (i: number, patch: Partial<CustomBodyRule>) => onSave(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const setCond = (i: number, j: number, c: RuleCondition) => setRule(i, { conds: rules[i]!.conds.map((x, k) => (k === j ? c : x)) });
  return (
    <div className="options-rules">
      {rules.map((r, i) => (
        <div key={r.id} className="options-rule">
          <div className="options-rule__head">
            <label className="options-toggle" title="Off keeps the rule without using it">
              <input type="checkbox" checked={r.on} disabled={busy} onChange={(ev) => setRule(i, { on: ev.target.checked })} />
            </label>
            <DraftText className="options-rule__name" value={r.name} disabled={busy} ariaLabel="Rule name" onCommit={(name) => setRule(i, { name })} />
            <button type="button" className="btn-small" disabled={busy} onClick={() => onSave(rules.filter((_, k) => k !== i))}>
              Remove
            </button>
          </div>
          {r.conds.map((c, j) => {
            const def = ruleFieldDef(c.field)!;
            return (
              <div key={j} className="options-rule__cond">
                <select
                  value={c.field}
                  disabled={busy}
                  aria-label="Field"
                  onChange={(ev) => setCond(i, j, freshCond(ev.target.value as RuleField))}
                >
                  {RULE_FIELDS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select value={c.op} disabled={busy} aria-label="Test" onChange={(ev) => setCond(i, j, { ...c, op: ev.target.value as RuleCondition["op"] })}>
                  {RULE_OPS[def.kind].map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {def.kind === "number" && (
                  <>
                    <DraftDecimal value={typeof c.value === "number" ? c.value : 0} disabled={busy} ariaLabel={`${def.label} value`} onCommit={(v) => setCond(i, j, { ...c, value: v })} />
                    {def.unit && <span className="dim tiny">{def.unit}</span>}
                  </>
                )}
                {def.kind === "text" && (
                  <DraftText
                    className="options-rule__text"
                    value={typeof c.value === "string" ? c.value : ""}
                    disabled={busy}
                    placeholder={c.field === "atmosphere" || c.field === "volcanism" ? "argon, or none" : "icy"}
                    ariaLabel={`${def.label} text`}
                    onCommit={(v) => setCond(i, j, { ...c, value: v })}
                  />
                )}
                <button
                  type="button"
                  className="btn-small"
                  disabled={busy}
                  aria-label="Remove condition"
                  onClick={() => setRule(i, { conds: r.conds.filter((_, k) => k !== j) })}
                >
                  ×
                </button>
              </div>
            );
          })}
          {r.conds.length < MAX_CONDS && (
            <button type="button" className="btn-small" disabled={busy} onClick={() => setRule(i, { conds: [...r.conds, freshCond("landable")] })}>
              + condition
            </button>
          )}
          {!r.conds.length && <span className="dim tiny"> A rule with no condition matches nothing.</span>}
        </div>
      ))}
      {rules.length < MAX_RULES && (
        <button
          type="button"
          className="btn-small"
          disabled={busy}
          onClick={() => onSave([...rules, { id: newId(rules), name: "My rule", on: true, conds: [freshCond("landable")] }])}
        >
          + rule
        </button>
      )}
    </div>
  );
}
