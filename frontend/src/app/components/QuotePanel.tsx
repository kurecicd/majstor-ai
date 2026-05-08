"use client";

import { useState } from "react";
import {
  Plus,
  Trash2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Link2,
  Check,
  X,
  Loader2,
  Info,
  Hammer,
} from "lucide-react";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StoreOption {
  name: string;
  price: number;
  source?: string;
  url?: string;
}

export interface QuoteRow {
  id: string;
  name: string;
  qty: number;
  unit: string;
  stores: StoreOption[];
  selectedStoreIdx: number;
  manualPrice: number;
  url: string;
}

export interface LaborItem {
  id: string;
  name: string;
  hours: number;
  rate: number;
}

export interface QuoteSection {
  id: string;
  name: string;
  rows: QuoteRow[];
  laborItems: LaborItem[];
  collapsed: boolean;
}

export interface Quote {
  sections: QuoteSection[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _uid = 0;
const uid = () => `${++_uid}`;

const fmt = (n: number) => Math.round(n).toLocaleString("sv-SE");

function rowPrice(r: QuoteRow): number {
  if (r.selectedStoreIdx >= 0 && r.stores[r.selectedStoreIdx]) {
    return r.stores[r.selectedStoreIdx].price;
  }
  return r.manualPrice;
}

function rowSelectedSource(r: QuoteRow): StoreOption | null {
  if (r.selectedStoreIdx >= 0 && r.stores[r.selectedStoreIdx]) {
    return r.stores[r.selectedStoreIdx];
  }
  return null;
}

export function parseAiQuote(raw: string): Quote | null {
  try {
    const d = JSON.parse(raw);
    if (!Array.isArray(d.sections)) return null;
    return {
      sections: d.sections.map((s: Record<string, unknown>) => {
        const rawLabor = (s.labor as Record<string, unknown>[]) ?? [];
        const laborItems: LaborItem[] =
          Array.isArray(rawLabor) && rawLabor.length > 0
            ? rawLabor.map((l) => ({
                id: uid(),
                name: (l.name as string) ?? "Labor",
                hours: Number(l.hours) || 0,
                rate: Number(l.rate) || 450,
              }))
            : [];
        return {
          id: uid(),
          name: (s.name as string) ?? "Section",
          collapsed: false,
          laborItems,
          rows: ((s.items as Record<string, unknown>[]) ?? []).map((it) => {
            const stores: StoreOption[] = Array.isArray(it.stores)
              ? (it.stores as Record<string, unknown>[]).map((st) => ({
                  name: (st.name as string) ?? "Store",
                  price: Number(st.price) || 0,
                  source: (st.source as string) || undefined,
                  url: (st.url as string) || undefined,
                }))
              : [];
            return {
              id: uid(),
              name: (it.name as string) ?? "",
              qty: Number(it.qty) || 1,
              unit: (it.unit as string) ?? "kom",
              stores,
              selectedStoreIdx: stores.length > 0 ? 0 : -1,
              manualPrice: stores[0]?.price ?? 0,
              url: (it.url as string) ?? "",
            };
          }),
        };
      }),
    };
  } catch {
    return null;
  }
}

export function extractQuoteFromResponse(text: string): {
  display: string;
  quote: Quote | null;
} {
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

// ─── Main Component ──────────────────────────────────────────────────────────

interface Props {
  quote: Quote;
  onChange: (q: Quote) => void;
}

export default function QuotePanel({ quote, onChange }: Props) {
  // Modal state — which row, in which section, is currently picking a store.
  const [picker, setPicker] = useState<{ s: number; r: number } | null>(null);

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
        {
          id: uid(),
          name: "New section",
          collapsed: false,
          laborItems: [],
          rows: [],
        },
      ],
    });

  const grand = quote.sections.reduce((t, s) => {
    const mat = s.rows.reduce((a, r) => a + r.qty * rowPrice(r), 0);
    const lab = s.laborItems.reduce((a, l) => a + l.hours * l.rate, 0);
    return t + mat + lab;
  }, 0);

  const pickerRow =
    picker && quote.sections[picker.s]?.rows[picker.r]
      ? quote.sections[picker.s].rows[picker.r]
      : null;

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center px-5 py-4 bg-white border-b shrink-0">
        <h2 className="font-bold text-gray-900 text-lg">Quote Builder</h2>
        <span className="text-base font-bold text-green-700">{fmt(grand)} kr</span>
      </div>

      {/* Sections */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {quote.sections.map((s, i) => (
          <SectionBlock
            key={s.id}
            section={s}
            onChange={(u) => updateSection(i, u)}
            onDelete={() => deleteSection(i)}
            onPickStore={(rowIdx) => setPicker({ s: i, r: rowIdx })}
          />
        ))}
        <button
          onClick={addSection}
          className="w-full border-2 border-dashed border-gray-200 text-gray-400 hover:border-green-600 hover:text-green-600 rounded-xl py-3 text-sm flex items-center justify-center gap-2 transition-colors"
        >
          <Plus size={16} /> Add section
        </button>
      </div>

      {/* Footer totals */}
      <div className="px-5 py-4 bg-white border-t shrink-0 space-y-1">
        <div className="flex justify-between text-sm text-gray-500">
          <span>Excl. VAT</span>
          <span>{fmt(grand)} kr</span>
        </div>
        <div className="flex justify-between font-bold text-green-700 text-lg">
          <span>Incl. VAT 25%</span>
          <span>{fmt(Math.round(grand * 1.25))} kr</span>
        </div>
      </div>

      {/* Store picker modal */}
      {picker && pickerRow && (
        <StorePickerModal
          row={pickerRow}
          onClose={() => setPicker(null)}
          onSelect={(updated) => {
            const sections = [...quote.sections];
            const section = { ...sections[picker.s] };
            const rows = [...section.rows];
            rows[picker.r] = updated;
            section.rows = rows;
            sections[picker.s] = section;
            onChange({ sections });
            setPicker(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

function SectionBlock({
  section,
  onChange,
  onDelete,
  onPickStore,
}: {
  section: QuoteSection;
  onChange: (s: QuoteSection) => void;
  onDelete: () => void;
  onPickStore: (rowIdx: number) => void;
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
        {
          id: uid(),
          name: "",
          qty: 1,
          unit: "kom",
          stores: [],
          selectedStoreIdx: -1,
          manualPrice: 0,
          url: "",
        },
      ],
    });

  const updateLabor = (i: number, l: LaborItem) => {
    const laborItems = [...section.laborItems];
    laborItems[i] = l;
    onChange({ ...section, laborItems });
  };
  const deleteLabor = (i: number) =>
    onChange({
      ...section,
      laborItems: section.laborItems.filter((_, j) => j !== i),
    });
  const addLabor = () =>
    onChange({
      ...section,
      laborItems: [
        ...section.laborItems,
        { id: uid(), name: "Labor", hours: 0, rate: 450 },
      ],
    });

  const matTotal = section.rows.reduce((a, r) => a + r.qty * rowPrice(r), 0);
  const workTotal = section.laborItems.reduce((a, l) => a + l.hours * l.rate, 0);
  const sectionTotal = matTotal + workTotal;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-gray-50 to-white border-b">
        <button
          onClick={() => onChange({ ...section, collapsed: !section.collapsed })}
          className="text-gray-400 hover:text-gray-700 shrink-0"
        >
          {section.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <input
          value={section.name}
          onChange={(e) => onChange({ ...section, name: e.target.value })}
          className="flex-1 bg-transparent font-bold text-base focus:outline-none text-gray-900"
        />
        <span className="text-sm font-bold text-green-700 shrink-0">
          {fmt(sectionTotal)} kr
        </span>
        <button
          onClick={onDelete}
          className="text-gray-300 hover:text-red-500 shrink-0"
          title="Delete section"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {!section.collapsed && (
        <div className="p-3 space-y-4">
          {/* Materials table */}
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Materials
              </span>
              <span className="text-xs text-gray-400">{fmt(matTotal)} kr</span>
            </div>
            {section.rows.length > 0 && (
              <div className="grid grid-cols-[1fr_56px_50px_150px_72px_24px] gap-1.5 px-2 pb-1 text-[10px] text-gray-400 uppercase tracking-wide">
                <span>Item</span>
                <span className="text-center">Qty</span>
                <span className="text-center">Unit</span>
                <span>Store</span>
                <span className="text-right">Total</span>
                <span />
              </div>
            )}
            <div className="space-y-1">
              {section.rows.map((r, i) => (
                <MaterialRow
                  key={r.id}
                  row={r}
                  onChange={(u) => updateRow(i, u)}
                  onDelete={() => deleteRow(i)}
                  onPickStore={() => onPickStore(i)}
                />
              ))}
            </div>
            <button
              onClick={addRow}
              className="mt-1.5 text-xs text-gray-400 hover:text-green-600 py-1 flex items-center gap-1 px-2 transition-colors"
            >
              <Plus size={13} /> Add material
            </button>
          </div>

          {/* Labor table */}
          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                <Hammer size={11} /> Labor
              </span>
              <span className="text-xs text-gray-400">{fmt(workTotal)} kr</span>
            </div>
            {section.laborItems.length > 0 && (
              <div className="grid grid-cols-[1fr_72px_88px_72px_24px] gap-1.5 px-2 pb-1 text-[10px] text-gray-400 uppercase tracking-wide">
                <span>Type</span>
                <span className="text-center">Hours</span>
                <span className="text-center">Rate (kr/h)</span>
                <span className="text-right">Total</span>
                <span />
              </div>
            )}
            <div className="space-y-1">
              {section.laborItems.map((l, i) => (
                <LaborRow
                  key={l.id}
                  labor={l}
                  onChange={(u) => updateLabor(i, u)}
                  onDelete={() => deleteLabor(i)}
                />
              ))}
            </div>
            <button
              onClick={addLabor}
              className="mt-1.5 text-xs text-gray-400 hover:text-amber-600 py-1 flex items-center gap-1 px-2 transition-colors"
            >
              <Plus size={13} /> Add labor
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Material Row ───────────────────────────────────────────────────────────

function MaterialRow({
  row,
  onChange,
  onDelete,
  onPickStore,
}: {
  row: QuoteRow;
  onChange: (r: QuoteRow) => void;
  onDelete: () => void;
  onPickStore: () => void;
}) {
  const total = row.qty * rowPrice(row);
  const sel = rowSelectedSource(row);

  return (
    <div className="group bg-gray-50 hover:bg-gray-100/70 rounded-lg px-2 py-1.5 transition-colors">
      <div className="grid grid-cols-[1fr_56px_50px_150px_72px_24px] gap-1.5 items-center text-sm">
        <input
          value={row.name}
          onChange={(e) => onChange({ ...row, name: e.target.value })}
          className="bg-white border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 text-sm min-w-0"
          placeholder="Item name"
        />
        <input
          type="number"
          min="0"
          step="0.5"
          value={row.qty}
          onChange={(e) =>
            onChange({ ...row, qty: parseFloat(e.target.value) || 0 })
          }
          className="bg-white border border-gray-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 text-center text-sm"
        />
        <input
          value={row.unit}
          onChange={(e) => onChange({ ...row, unit: e.target.value })}
          className="bg-white border border-gray-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 text-center text-sm"
        />
        <button
          onClick={onPickStore}
          className="bg-white border border-gray-200 hover:border-green-500 rounded px-2 py-1.5 text-left flex items-center gap-1 text-sm transition-colors"
          title="Choose store / source"
        >
          <span className="flex-1 truncate">
            {sel ? (
              <>
                <span className="font-medium text-gray-900">{sel.name}</span>{" "}
                <span className="text-gray-500">{fmt(sel.price)} kr</span>
              </>
            ) : row.manualPrice > 0 ? (
              <>
                <span className="text-gray-500">Manual </span>
                <span className="font-medium text-gray-900">
                  {fmt(row.manualPrice)} kr
                </span>
              </>
            ) : (
              <span className="text-gray-400">Choose…</span>
            )}
          </span>
          <ChevronDown size={12} className="text-gray-400 shrink-0" />
        </button>
        <span className="text-right font-semibold text-gray-800">
          {fmt(total)} kr
        </span>
        <button
          onClick={onDelete}
          className="text-gray-300 group-hover:text-red-400 hover:!text-red-600 transition-colors"
          title="Delete row"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Source / link badge — visible when a store with source/url is selected, or a custom URL is set */}
      {(sel?.source || sel?.url || row.url) && (
        <div className="flex items-center gap-2 px-1 pt-1 text-[11px] text-gray-500">
          <Info size={11} className="shrink-0 text-gray-400" />
          <span className="truncate">
            {sel?.source ?? "Custom link"}
          </span>
          {(sel?.url || row.url) && (
            <a
              href={sel?.url || row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-700 inline-flex items-center gap-0.5 shrink-0"
            >
              View <ExternalLink size={10} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Labor Row ──────────────────────────────────────────────────────────────

function LaborRow({
  labor,
  onChange,
  onDelete,
}: {
  labor: LaborItem;
  onChange: (l: LaborItem) => void;
  onDelete: () => void;
}) {
  const total = labor.hours * labor.rate;
  return (
    <div className="group bg-amber-50/40 hover:bg-amber-50 rounded-lg px-2 py-1.5 transition-colors">
      <div className="grid grid-cols-[1fr_72px_88px_72px_24px] gap-1.5 items-center text-sm">
        <input
          value={labor.name}
          onChange={(e) => onChange({ ...labor, name: e.target.value })}
          className="bg-white border border-amber-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-sm min-w-0"
          placeholder="Labor type"
        />
        <input
          type="number"
          min="0"
          step="0.5"
          value={labor.hours || ""}
          onChange={(e) =>
            onChange({ ...labor, hours: parseFloat(e.target.value) || 0 })
          }
          placeholder="0"
          className="bg-white border border-amber-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-center text-sm"
        />
        <input
          type="number"
          min="0"
          value={labor.rate}
          onChange={(e) =>
            onChange({ ...labor, rate: parseFloat(e.target.value) || 0 })
          }
          className="bg-white border border-amber-200 rounded px-1 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500 text-center text-sm"
        />
        <span className="text-right font-semibold text-gray-800">
          {fmt(total)} kr
        </span>
        <button
          onClick={onDelete}
          className="text-gray-300 group-hover:text-red-400 hover:!text-red-600 transition-colors"
          title="Delete labor"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Store Picker Modal ─────────────────────────────────────────────────────

function StorePickerModal({
  row,
  onClose,
  onSelect,
}: {
  row: QuoteRow;
  onClose: () => void;
  onSelect: (r: QuoteRow) => void;
}) {
  const [manualMode, setManualMode] = useState(
    row.selectedStoreIdx === -1 && row.manualPrice > 0
  );
  const [manualPrice, setManualPrice] = useState(row.manualPrice || 0);

  const [linkMode, setLinkMode] = useState(false);
  const [linkUrl, setLinkUrl] = useState(row.url || "");
  const [linkName, setLinkName] = useState("");
  const [linkPrice, setLinkPrice] = useState(0);
  const [linkStore, setLinkStore] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const pickStore = (idx: number) => {
    onSelect({
      ...row,
      selectedStoreIdx: idx,
      manualPrice: row.stores[idx]?.price ?? row.manualPrice,
    });
  };

  const saveManual = () => {
    onSelect({
      ...row,
      selectedStoreIdx: -1,
      manualPrice: manualPrice || 0,
    });
  };

  const fetchLink = async () => {
    if (!linkUrl) return;
    setFetching(true);
    setFetchError(null);
    setFetched(false);
    try {
      const res = await fetch(`${BACKEND}/api/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkUrl }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.name) setLinkName(data.name);
        if (data.price) setLinkPrice(data.price);
        if (data.store) setLinkStore(data.store);
        setFetched(true);
      } else {
        setFetchError(data.error || "Could not extract product info — fill manually below.");
        if (data.store) setLinkStore(data.store);
      }
    } catch {
      setFetchError("Fetch failed. Fill the fields manually below.");
    } finally {
      setFetching(false);
    }
  };

  const saveLink = () => {
    if (!linkUrl) return;
    const newOption: StoreOption = {
      name: linkStore || "Custom",
      price: linkPrice || 0,
      source: linkUrl,
      url: linkUrl,
    };
    const stores = [...row.stores, newOption];
    onSelect({
      ...row,
      stores,
      selectedStoreIdx: stores.length - 1,
      manualPrice: linkPrice || 0,
      url: linkUrl,
      name: row.name || linkName || "",
    });
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 text-base">Pick source / store</h3>
            <p className="text-xs text-gray-500 truncate">
              {row.name || "Item"} — {row.qty} {row.unit}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Existing store options */}
          {row.stores.length > 0 ? (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Suggested stores
              </div>
              {row.stores.map((s, i) => (
                <button
                  key={i}
                  onClick={() => pickStore(i)}
                  className={`w-full text-left border rounded-xl p-3 hover:border-green-500 hover:bg-green-50/40 transition-colors flex items-start gap-3 ${
                    row.selectedStoreIdx === i
                      ? "border-green-500 bg-green-50"
                      : "border-gray-200"
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${
                      row.selectedStoreIdx === i
                        ? "border-green-600 bg-green-600"
                        : "border-gray-300"
                    }`}
                  >
                    {row.selectedStoreIdx === i && (
                      <Check size={12} className="text-white" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900">
                        {s.name}
                      </span>
                      <span className="font-bold text-gray-900 shrink-0">
                        {fmt(s.price)} kr
                      </span>
                    </div>
                    {s.source && (
                      <div className="text-xs text-gray-500 mt-0.5 truncate">
                        Source: {s.source}
                      </div>
                    )}
                    {s.url && (
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-blue-600 hover:text-blue-800 inline-flex items-center gap-0.5 mt-1"
                      >
                        View product <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
              No store suggestions yet. Use a manual price or paste a product link below.
            </div>
          )}

          {/* Divider */}
          <div className="border-t border-gray-100 my-2" />

          {/* Manual price option */}
          <div className="space-y-2">
            <button
              onClick={() => {
                setManualMode((m) => !m);
                setLinkMode(false);
              }}
              className={`w-full text-left border rounded-xl p-3 transition-colors flex items-start gap-3 ${
                manualMode
                  ? "border-green-500 bg-green-50"
                  : "border-gray-200 hover:border-gray-400"
              }`}
            >
              <div
                className={`w-5 h-5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${
                  manualMode
                    ? "border-green-600 bg-green-600"
                    : "border-gray-300"
                }`}
              >
                {manualMode && <Check size={12} className="text-white" />}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-gray-900">Manual price</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Type your own unit price. No source attached.
                </div>
              </div>
            </button>
            {manualMode && (
              <div className="pl-8 flex items-center gap-2">
                <input
                  type="number"
                  value={manualPrice || ""}
                  onChange={(e) => setManualPrice(parseFloat(e.target.value) || 0)}
                  placeholder="kr / unit"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  onClick={saveManual}
                  className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-4 py-2 text-sm font-semibold"
                >
                  Use
                </button>
              </div>
            )}
          </div>

          {/* Custom link option */}
          <div className="space-y-2">
            <button
              onClick={() => {
                setLinkMode((m) => !m);
                setManualMode(false);
              }}
              className={`w-full text-left border rounded-xl p-3 transition-colors flex items-start gap-3 ${
                linkMode
                  ? "border-blue-500 bg-blue-50/60"
                  : "border-gray-200 hover:border-gray-400"
              }`}
            >
              <Link2
                size={18}
                className={`shrink-0 mt-0.5 ${
                  linkMode ? "text-blue-600" : "text-gray-400"
                }`}
              />
              <div className="flex-1">
                <div className="font-semibold text-gray-900">Paste product link</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  We try to fetch name + price from the page. If it fails, fill manually — we still save the link.
                </div>
              </div>
            </button>
            {linkMode && (
              <div className="pl-8 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://www.bauhaus.se/..."
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={fetchLink}
                    disabled={!linkUrl || fetching}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1 shrink-0"
                  >
                    {fetching ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      "Fetch"
                    )}
                  </button>
                </div>
                {fetchError && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    {fetchError}
                  </div>
                )}
                {fetched && !fetchError && (
                  <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2 flex items-center gap-1">
                    <Check size={12} /> Fetched successfully
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <input
                    value={linkStore}
                    onChange={(e) => setLinkStore(e.target.value)}
                    placeholder="Store"
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    value={linkName}
                    onChange={(e) => setLinkName(e.target.value)}
                    placeholder="Product name"
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <input
                    type="number"
                    value={linkPrice || ""}
                    onChange={(e) =>
                      setLinkPrice(parseFloat(e.target.value) || 0)
                    }
                    placeholder="Price kr"
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
                  />
                </div>
                <button
                  onClick={saveLink}
                  disabled={!linkUrl}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg py-2 text-sm font-semibold"
                >
                  Save link as source
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
