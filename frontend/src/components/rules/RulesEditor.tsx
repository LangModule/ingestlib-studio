import { useState } from "react";
import type { RulesConfig, UnmatchedMode } from "../../api/types";
import { IconCheck, IconTrash } from "../icons";
import { Field, TextInput } from "../setup/ui";

/* The content-rules editor — classification rules and split categories,
   shared by Settings (saved mode) and Try it (per-run override mode).
   Layout follows the LlamaCloud pattern: each rule set is a bordered table
   (column headers, rows, "+ Add" as the table footer); the uncategorized
   policy sits outside the table as its own block.

   Rows live as arrays internally so names can be edited without React keys
   jumping; onChange emits the RulesConfig record shape (empty names dropped,
   the last duplicate name wins). Parents reset the editor by changing its
   `key`, which reseeds the rows from `initial`. */

const MAX_CLASSIFY_RULES = 20;
const MAX_SPLIT_CATEGORIES = 50;

const UNMATCHED_OPTIONS: { value: UnmatchedMode; label: string }[] = [
  { value: "require", label: "Require a match" },
  { value: "other", label: "Group as 'Other'" },
  { value: "skip", label: "Skip unmatched pages" },
];

type Row = { name: string; description: string };

export function emptyRules(): RulesConfig {
  return {
    classify: { rules: {}, target_pages: "", max_pages: 0 },
    split: { categories: {}, unmatched: "other" },
  };
}

function normalize(rules: RulesConfig): RulesConfig {
  const sorted = (record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return {
    classify: {
      rules: sorted(rules.classify.rules),
      target_pages: rules.classify.target_pages.trim(),
      max_pages: rules.classify.max_pages,
    },
    split: {
      categories: sorted(rules.split.categories),
      // without categories the mode is inert — treat it as the default
      unmatched: Object.keys(rules.split.categories).length
        ? rules.split.unmatched
        : "other",
    },
  };
}

export function rulesEqual(a: RulesConfig, b: RulesConfig): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export function rulesAreEmpty(rules: RulesConfig): boolean {
  return rulesEqual(rules, emptyRules());
}

function toRows(record: Record<string, string>): Row[] {
  return Object.entries(record).map(([name, description]) => ({ name, description }));
}

function toRecord(rows: Row[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) record[name] = row.description;
  }
  return record;
}

function RuleTable({
  rows,
  max,
  nameHeader,
  namePlaceholder,
  descriptionPlaceholder,
  addLabel,
  emptyText,
  disabled,
  onRows,
}: {
  rows: Row[];
  max: number;
  nameHeader: string;
  namePlaceholder: string;
  descriptionPlaceholder: string;
  addLabel: string;
  emptyText: string;
  disabled: boolean;
  onRows: (rows: Row[]) => void;
}) {
  const update = (index: number, patch: Partial<Row>) =>
    onRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="rounded-lg border border-line">
      <div className="grid grid-cols-[2fr_3fr_3.5rem] items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium">
        <span>{nameHeader}</span>
        <span>Description (optional)</span>
        <span />
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-soft">{emptyText}</p>
      ) : (
        <div className="flex flex-col gap-2 px-4 py-3">
          {rows.map((row, index) => (
            <div
              key={index}
              className="grid grid-cols-[2fr_3fr_3.5rem] items-center gap-2"
            >
              <TextInput
                className="mono"
                placeholder={namePlaceholder}
                value={row.name}
                disabled={disabled}
                onChange={(e) => update(index, { name: e.target.value })}
              />
              <TextInput
                placeholder={descriptionPlaceholder}
                value={row.description}
                disabled={disabled}
                onChange={(e) => update(index, { description: e.target.value })}
              />
              <button
                type="button"
                title="Remove"
                disabled={disabled}
                onClick={() => onRows(rows.filter((_, i) => i !== index))}
                className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-soft transition hover:border-fail hover:text-fail disabled:opacity-40"
              >
                <IconTrash />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-line px-4 py-2.5">
        <button
          type="button"
          disabled={disabled || rows.length >= max}
          onClick={() => onRows([...rows, { name: "", description: "" }])}
          className="text-sm font-medium text-ink transition hover:text-accent disabled:opacity-40"
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}

function SectionHeader({ title, count, max }: { title: string; count: number; max: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-base font-semibold">{title}</h3>
      <span className="mono text-xs text-ink-soft">{count}/{max}</span>
    </div>
  );
}

export function RulesEditor({
  initial,
  disabled = false,
  columns = false,
  onChange,
}: {
  initial: RulesConfig;
  disabled?: boolean;
  /** true renders classify and split side by side (wide pages like Settings). */
  columns?: boolean;
  onChange: (rules: RulesConfig) => void;
}) {
  const [classifyRows, setClassifyRows] = useState<Row[]>(toRows(initial.classify.rules));
  const [targetPages, setTargetPages] = useState(initial.classify.target_pages);
  const [maxPages, setMaxPages] = useState(initial.classify.max_pages);
  const [splitRows, setSplitRows] = useState<Row[]>(toRows(initial.split.categories));
  const [unmatched, setUnmatched] = useState<UnmatchedMode>(initial.split.unmatched);

  const emit = (next: {
    classifyRows?: Row[];
    targetPages?: string;
    maxPages?: number;
    splitRows?: Row[];
    unmatched?: UnmatchedMode;
  }) => {
    const state = {
      classifyRows: next.classifyRows ?? classifyRows,
      targetPages: next.targetPages ?? targetPages,
      maxPages: next.maxPages ?? maxPages,
      splitRows: next.splitRows ?? splitRows,
      unmatched: next.unmatched ?? unmatched,
    };
    if (next.classifyRows !== undefined) setClassifyRows(next.classifyRows);
    if (next.targetPages !== undefined) setTargetPages(next.targetPages);
    if (next.maxPages !== undefined) setMaxPages(next.maxPages);
    if (next.splitRows !== undefined) setSplitRows(next.splitRows);
    if (next.unmatched !== undefined) setUnmatched(next.unmatched);
    onChange({
      classify: {
        rules: toRecord(state.classifyRows),
        target_pages: state.targetPages.trim(),
        max_pages: state.maxPages,
      },
      split: {
        categories: toRecord(state.splitRows),
        unmatched: state.unmatched,
      },
    });
  };

  return (
    <div
      className={
        columns ? "grid items-start gap-8 lg:grid-cols-2" : "flex flex-col gap-8"
      }
    >
      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Classification rules"
          count={classifyRows.length}
          max={MAX_CLASSIFY_RULES}
        />
        <RuleTable
          rows={classifyRows}
          max={MAX_CLASSIFY_RULES}
          nameHeader="Document type"
          namePlaceholder="e.g., invoice"
          descriptionPlaceholder="e.g., Contains itemized charges, tax info, and payment terms"
          addLabel="+ Add rule"
          emptyText='No rules — classify is open-ended and invents the best label itself. Add rules to constrain it to your document types (or "uncategorized").'
          disabled={disabled}
          onRows={(rows) => emit({ classifyRows: rows })}
        />
        <div className="grid max-w-xl grid-cols-2 gap-3">
          <Field label="Target pages" hint="1-based pages/ranges; empty = all">
            <TextInput
              className="mono"
              placeholder="e.g. 1, 3, 5-7"
              value={targetPages}
              disabled={disabled}
              onChange={(e) => emit({ targetPages: e.target.value })}
            />
          </Field>
          <Field label="Max pages" hint="cap after selection; 0 = no cap">
            <TextInput
              className="mono"
              type="number"
              min={0}
              value={String(maxPages)}
              disabled={disabled}
              onChange={(e) => emit({ maxPages: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Split categories"
          count={splitRows.length}
          max={MAX_SPLIT_CATEGORIES}
        />
        <RuleTable
          rows={splitRows}
          max={MAX_SPLIT_CATEGORIES}
          nameHeader="Category name"
          namePlaceholder="e.g., financial_statements"
          descriptionPlaceholder="e.g., Pages containing financial tables, charts, and summary metrics"
          addLabel="+ Add category"
          emptyText="No categories — split discovers the section vocabulary itself. Add categories to label pages against YOUR sections instead."
          disabled={disabled}
          onRows={(rows) => emit({ splitRows: rows })}
        />
        <div>
          <h4 className="text-sm font-semibold">Uncategorized pages</h4>
          <p className="mt-0.5 text-xs text-ink-soft">
            {splitRows.length === 0
              ? "add a category first — this only applies when pages can miss your categories"
              : "how to handle pages that don't match any category"}
          </p>
          <div className="mt-2 grid max-w-xl grid-cols-3 gap-2">
            {UNMATCHED_OPTIONS.map((option) => {
              const selected = unmatched === option.value;
              return (
                <button
                  type="button"
                  key={option.value}
                  disabled={disabled || splitRows.length === 0}
                  onClick={() => emit({ unmatched: option.value })}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition disabled:opacity-40 ${
                    selected
                      ? "border-accent bg-card text-ink ring-1 ring-accent"
                      : "border-line bg-card text-ink-soft hover:border-ink-soft"
                  }`}
                >
                  {selected && <IconCheck className="mr-1 inline h-3 w-3 text-accent" />}
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
