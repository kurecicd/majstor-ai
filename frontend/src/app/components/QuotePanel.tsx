"use client";

import { Plus, Trash2, ExternalLink, ChevronDown, ChevronUp, Link2 } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StoreOption {
  name: string;
  price: number;
}

export interface QuoteRow {
  id: string;
  name: string;
  qty: number;
  unit: string;
  stores: StoreOption[];
  selectedStoreIdx: number; // -1 = manual price
  manualPrice: number;
  url: string;
  showUrl: boolean;
}

export interface QuoteSection {
  id: string;
  name: string;
  rows: QuoteRow[];
  workHours: number;
  workRate: number;
  collapsed: boolean;
}

export interface Quote {
  sections: QuoteSection[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _uid = 0;
const uid = () => `${++_uid}`;

function fmt(n: number) {
  return Math.round(n).toLocaleString("sv-SE");
}

function rowPrice(r: QuoteRow): number {
  return r.selectedStoreIdx >= 0
    ? (r.stores[r.selectedStoreIdx]?.price ?? r.manualPrice)
    : r.manualPrice;
}

export function parseAiQuote(raw: string): Quote | null {
  try {
    const d = JSON.parse(raw);
    if (!Array.isArray(d.sections)) return null;
    return {
      sections: d.sections.map((s: Record<string, unknown>) => ({
        id: uid(),
        name: (s.name as string) ?? "Section",
        collapsed: false,
        workHours: 0,
        workRate: 450,
        rows: ((s.items as Record<string, unknown>[]) ?? []).map((it) => ({
          id: uid(),
          name: (it.name as string) ?? "",
          qty: Number(it.qty) || 1,
          unit: (it.unit as string) ?? "kom",
          stores: Array.isArray(it.stores) ? it.stores : [],
          selectedStoreIdx: Array.isArray(it.stores) && it.stores.length > 0 ? 0 : -1,
          manualPrice: (Array.isArray(it.stores) && it.stores[0]?.price) || 0,
          url: "",
          showUrl: false,
        })),
      })),
    };
  } catch {
    return null;
  }
}

export function extractQuoteFromResponse(text: string): { display: string; quote: Quote | null } {
  const S = "<<<QUOTE>>>";
  const E = "<<<END_QUOTE>>>";
  const si = text.indexOf(S);
  const ei = text.indexOf(E);
  if (si === -1 || ei === -1 || ei < si) return { display: text, quote: null };
  const json = text.slice(si + S.length, ei).trim();
  const quote = parseAiQuote(json);
  const display = (text.slice(0, si) + text.slice(ei + E.length)).trim();
  return { display, quote };
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  quote: Quote;
  onChange: (q: Quote) => void;
}

export default function QuotePanel({ quote, onChange }: Props) {
  const updateSection = (i: number, s: QuoteSection) => {
    const sections = [...quote.sections];
    sections[i] = s;
    onChange({ sections });
  };
  const deleteSection = (i: number) =>
    onChange({ sections: quote.sections.filter((_, j) => j !== i) });
  const addSection = () =>
    onChange({
      sections: [
        ...quote.sections,
        { id: uid(), name: "New section", collapsed: false, workHours: 0, workRate: 450, rows: [] },
      ],
    });

  const grand = quote.sections.reduce((t, s) => {
    const mat = s.rows.reduce((a, r) => a + r.qty * rowPrice(r), 0);
    return t + mat + s.workHours * s.workRate;
  }, 0);

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center px-4 py-3 bg-white border-b shrink-0">
        <h2 className="font-bold text-gray-900 text-base">Quote Builder</h2>
        <span className="text-sm font-semibold text-green-700">{fmt(grand)} kr</span>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {quote.sections.map((s, i) => (
          <SectionBlock
            key={s.id}
            section={s}
            onChange={(u) => updateSection(i, u)}
            onDelete={() => deleteSection(i)}
          />
        ))}
        <button
          onClick={addSection}
          className="w-full border-2 border-dashed border-gray-200 text-gray-400 hover:border-green-600 hover:text-green-600 rounded-xl py-2 text-sm flex items-center justify-center gap-1 transition-colors"
        >
          <Plus size={15} /> Add section
        </button>
      </div>

      {/* Footer totals */}
      <div className="px-4 py-3 bg-white border-t shrink-0 space-y-0.5">
        <div className="flex justify-between text-sm text-gray-500">
          <span>Excl. VAT</span>
          <span>{fmt(grand)} kr</span>
        </div>
        <div className="flex justify-between font-bold text-green-700 text-base">
          <span>Incl. VAT 25%</span>
          <span>{fmt(Math.round(grand * 1.25))} kr</span>
        </div>
      </div>
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

function SectionBlock({
  section,
  onChange,
  onDelete,
}: {
  section: QuoteSection;
  onChange: (s: QuoteSection) => void;
  onDelete: () => void;
}) {
  const updateRow = (i: number, r: QuoteRow) => {
    const rows = [...section.rows];
    rows[i] = r;
    onChange({ ...section, rows });
  };
  const deleteRow = (i: number) =>
    onChange({ ...section, rows: section.rows.filter((_, j) => j !== i) });
  const addRow = () =>
    onChange({
      ...section,
      rows: [
        ...section.rows,
        { id: uid(), name: "", qty: 1, unit: "kom", stores: [], selectedStoreIdx: -1, manualPrice: 0, url: "", showUrl: false },
      ],
    });

  const matTotal = section.rows.reduce((a, r) => a + r.qty * rowPrice(r), 0);
  const workTotal = section.workHours * section.workRate;
  const sectionTotal = matTotal + workTotal;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Section header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b">
        <button
          onClick={() => onChange({ ...section, collapsed: !section.collapsed })}
          className="text-gray-400 hover:text-gray-700 shrink-0"
        >
          {section.collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
        <input
          value={section.name}
          onChange={(e) => onChange({ ...section, name: e.target.value })}
          className="flex-1 bg-transparent font-semibold text-sm focus:outline-none text-gray-900"
        />
        <span className="text-xs font-semibold text-green-700 shrink-0">{fmt(sectionTotal)} kr</span>
        <button onClick={onDelete} className="text-gray-200 hover:text-red-400 shrink-0">
          <Trash2 size={13} />
        </button>
      </div>

      {!section.collapsed && (
        <div className="p-2 space-y-1.5">
          {/* Column headers */}
          {section.rows.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400 px-0.5 pb-0.5">
              <span className="flex-1 min-w-0">Item</span>
              <span className="w-14 text-center">Qty</span>
              <span className="w-12 text-center">Unit</span>
              <span className="w-[130px]">Store / Price</span>
              <span className="w-20 text-right">Total</span>
              <span className="w-5" />
              <span className="w-4" />
            </div>
          )}

          {section.rows.map((r, i) => (
            <RowBlock key={r.id} row={r} onChange={(u) => updateRow(i, u)} onDelete={() => deleteRow(i)} />
          ))}

          <button
            onClick={addRow}
            className="text-xs text-gray-400 hover:text-green-600 py-0.5 flex items-center gap-1 pl-0.5"
          >
            <Plus size={12} /> Add item
          </button>

          {/* Work / labour row */}
          <div className="flex items-center gap-2 pt-2 mt-1 border-t border-gray-100 text-xs text-gray-500 flex-wrap">
            <span className="shrink-0 font-medium">Work:</span>
            <input
              type="number"
              min="0"
              value={section.workHours || ""}
              onChange={(e) => onChange({ ...section, workHours: parseFloat(e.target.value) || 0 })}
              placeholder="0"
              className="w-16 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500 text-xs"
            />
            <span>h ×</span>
            <input
              type="number"
              min="0"
              value={section.workRate}
              onChange={(e) => onChange({ ...section, workRate: parseFloat(e.target.value) || 0 })}
              className="w-20 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500 text-xs"
            />
            <span>kr/h =</span>
            <span className="font-semibold text-gray-700">{fmt(workTotal)} kr</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function RowBlock({
  row,
  onChange,
  onDelete,
}: {
  row: QuoteRow;
  onChange: (r: QuoteRow) => void;
  onDelete: () => void;
}) {
  const price = rowPrice(row);
  const total = row.qty * price;

  return (
    <div className="group space-y-1">
      <div className="flex items-center gap-1.5 text-xs">
        {/* Name */}
        <input
          value={row.name}
          onChange={(e) => onChange({ ...row, name: e.target.value })}
          className="flex-1 min-w-0 bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500 text-xs"
          placeholder="Item name"
        />
        {/* Qty */}
        <input
          type="number"
          min="0"
          step="0.5"
          value={row.qty}
          onChange={(e) => onChange({ ...row, qty: parseFloat(e.target.value) || 0 })}
          className="w-14 border border-gray-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-green-500 text-center text-xs"
        />
        {/* Unit */}
        <input
          value={row.unit}
          onChange={(e) => onChange({ ...row, unit: e.target.value })}
          className="w-12 border border-gray-200 rounded px-1 py-1 focus:outline-none text-center text-xs"
        />
        {/* Store selector */}
        {row.stores.length > 0 ? (
          <select
            value={row.selectedStoreIdx}
            onChange={(e) => {
              const idx = parseInt(e.target.value);
              onChange({
                ...row,
                selectedStoreIdx: idx,
                manualPrice: idx === -1 ? row.manualPrice : (row.stores[idx]?.price ?? 0),
              });
            }}
            className="text-xs border border-gray-200 rounded px-1 py-1 bg-white w-[130px] focus:outline-none"
          >
            {row.stores.map((s, i) => (
              <option key={i} value={i}>
                {s.name} – {s.price} kr
              </option>
            ))}
            <option value={-1}>Manual…</option>
          </select>
        ) : null}
        {/* Manual price input */}
        {(row.stores.length === 0 || row.selectedStoreIdx === -1) && (
          <input
            type="number"
            value={row.manualPrice || ""}
            onChange={(e) => onChange({ ...row, manualPrice: parseFloat(e.target.value) || 0, selectedStoreIdx: -1 })}
            placeholder="kr/st"
            className="w-20 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500 text-right text-xs"
          />
        )}
        {/* Line total */}
        <span className="w-20 text-right font-semibold text-gray-700 shrink-0">{fmt(total)} kr</span>
        {/* Link toggle */}
        <button
          onClick={() => onChange({ ...row, showUrl: !row.showUrl })}
          className={`shrink-0 transition-colors ${row.url ? "text-blue-500" : "text-gray-200 group-hover:text-gray-400"}`}
          title="Add product link"
        >
          <Link2 size={13} />
        </button>
        {/* Delete */}
        <button onClick={onDelete} className="shrink-0 text-gray-200 group-hover:text-red-400">
          <Trash2 size={12} />
        </button>
      </div>

      {/* URL row */}
      {row.showUrl && (
        <div className="flex items-center gap-1.5 pl-2">
          <input
            type="url"
            value={row.url}
            onChange={(e) => onChange({ ...row, url: e.target.value })}
            placeholder="https://bauhaus.se/..."
            className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {row.url && (
            <a href={row.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 shrink-0">
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
