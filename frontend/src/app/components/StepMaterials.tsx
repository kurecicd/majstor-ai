"use client";

import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Hammer,
  Package,
  ArrowRight,
} from "lucide-react";
import {
  Quote,
  QuoteSection,
  QuoteRow,
  LaborItem,
  uid,
  fmt,
  sectionMaterialTotal,
  sectionLaborTotal,
} from "./QuotePanel";

export default function StepMaterials({
  quote,
  onChange,
  onBack,
  onContinue,
}: {
  quote: Quote;
  onChange: (q: Quote) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
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
          name: "Ny sektion",
          collapsed: false,
          laborItems: [],
          rows: [],
        },
      ],
    });

  const totalMaterials = quote.sections.reduce(
    (a, s) => a + s.rows.length,
    0
  );
  const totalLabor = quote.sections.reduce(
    (a, s) => a + s.laborItems.length,
    0
  );

  return (
    <div className="max-w-3xl mx-auto w-full p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">
          Steg 2 — Material och arbete
        </h2>
        <p className="text-sm text-gray-500">
          Granska, ändra och lägg till poster. Priser hämtas i nästa steg.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {quote.sections.map((s, i) => (
          <SectionCard
            key={s.id}
            section={s}
            onChange={(u) => updateSection(i, u)}
            onDelete={() => deleteSection(i)}
          />
        ))}
        <button
          onClick={addSection}
          className="w-full border-2 border-dashed border-gray-200 text-gray-400 hover:border-green-600 hover:text-green-600 rounded-xl py-3 text-sm flex items-center justify-center gap-2 transition-colors"
        >
          <Plus size={16} /> Lägg till sektion
        </button>
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          ← Tillbaka
        </button>
        <div className="text-xs text-gray-500">
          {totalMaterials} material · {totalLabor} arbete
        </div>
        <button
          onClick={onContinue}
          disabled={totalMaterials === 0}
          className="bg-green-700 hover:bg-green-800 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-colors"
        >
          Hämta priser <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Section card ──────────────────────────────────────────────────────────

function SectionCard({
  section,
  onChange,
  onDelete,
}: {
  section: QuoteSection;
  onChange: (s: QuoteSection) => void;
  onDelete: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);

  function openAdd() {
    if (addBtnRef.current) {
      const r = addBtnRef.current.getBoundingClientRect();
      setDropPos({ top: r.bottom + 4, left: r.left });
    }
    setAddOpen(true);
  }

  const updateRow = (i: number, r: QuoteRow) => {
    const rows = [...section.rows];
    rows[i] = r;
    onChange({ ...section, rows });
  };
  const deleteRow = (i: number) =>
    onChange({ ...section, rows: section.rows.filter((_, j) => j !== i) });
  const addRow = () => {
    setAddOpen(false);
    onChange({
      ...section,
      rows: [
        ...section.rows,
        {
          id: uid(),
          name: "",
          qty: 1,
          unit: "st",
          stores: [],
          selectedStoreIdx: -1,
          manualPrice: 0,
          url: "",
        },
      ],
    });
  };

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
  const addLabor = () => {
    setAddOpen(false);
    onChange({
      ...section,
      laborItems: [
        ...section.laborItems,
        { id: uid(), name: "Arbete", hours: 0, rate: 450 },
      ],
    });
  };

  const matCount = section.rows.length;
  const labCount = section.laborItems.length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-gray-50 to-white border-b">
        <button
          onClick={() => onChange({ ...section, collapsed: !section.collapsed })}
          className="text-gray-400 hover:text-gray-700 shrink-0"
        >
          {section.collapsed ? (
            <ChevronRight size={16} />
          ) : (
            <ChevronDown size={16} />
          )}
        </button>
        <input
          value={section.name}
          onChange={(e) => onChange({ ...section, name: e.target.value })}
          className="flex-1 bg-transparent font-bold text-base focus:outline-none text-gray-900"
        />
        <span className="text-xs text-gray-400 shrink-0">
          {matCount} material · {labCount} arbete
        </span>
        <button
          onClick={onDelete}
          className="text-gray-300 hover:text-red-500 shrink-0"
          title="Ta bort sektion"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {!section.collapsed && (
        <div className="p-3 space-y-4">
          {/* Materials */}
          {matCount > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                  <Package size={11} /> Material
                </span>
              </div>
              <div className="grid grid-cols-[1fr_72px_72px_24px] gap-1.5 px-2 pb-1 text-[10px] text-gray-400 uppercase tracking-wide">
                <span>Namn</span>
                <span className="text-center">Antal</span>
                <span className="text-center">Enhet</span>
                <span />
              </div>
              <div className="space-y-1">
                {section.rows.map((r, i) => (
                  <MaterialEditRow
                    key={r.id}
                    row={r}
                    onChange={(u) => updateRow(i, u)}
                    onDelete={() => deleteRow(i)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Labor */}
          {labCount > 0 && (
            <div className={matCount > 0 ? "border-t border-gray-100 pt-3" : ""}>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1">
                  <Hammer size={11} /> Arbete
                </span>
                <span className="text-xs text-gray-400">
                  {fmt(sectionLaborTotal(section))} kr
                </span>
              </div>
              <div className="grid grid-cols-[1fr_72px_88px_72px_24px] gap-1.5 px-2 pb-1 text-[10px] text-gray-400 uppercase tracking-wide">
                <span>Typ</span>
                <span className="text-center">Timmar</span>
                <span className="text-center">Pris (kr/h)</span>
                <span className="text-right">Summa</span>
                <span />
              </div>
              <div className="space-y-1">
                {section.laborItems.map((l, i) => (
                  <LaborEditRow
                    key={l.id}
                    labor={l}
                    onChange={(u) => updateLabor(i, u)}
                    onDelete={() => deleteLabor(i)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Add row dropdown — rendered via portal so overflow-y-auto doesn't clip it */}
          <div className="pt-1">
            <button
              ref={addBtnRef}
              onClick={openAdd}
              className="text-sm text-gray-500 hover:text-green-700 py-1 flex items-center gap-1.5 transition-colors"
            >
              <Plus size={14} /> Lägg till rad
              <ChevronDown size={12} className={addOpen ? "rotate-180" : ""} />
            </button>
            {addOpen && dropPos && createPortal(
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setAddOpen(false)}
                />
                <div
                  className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden min-w-[220px]"
                  style={{ top: dropPos.top, left: dropPos.left }}
                >
                  <button
                    onClick={addRow}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-3"
                  >
                    <Package size={15} className="text-gray-500 shrink-0" />
                    <span>
                      <span className="font-semibold text-gray-900">Material</span>
                      <span className="text-xs text-gray-500 block">Vara, mängd och enhet</span>
                    </span>
                  </button>
                  <button
                    onClick={addLabor}
                    className="w-full text-left px-4 py-3 text-sm hover:bg-amber-50 flex items-center gap-3 border-t border-gray-100"
                  >
                    <Hammer size={15} className="text-amber-600 shrink-0" />
                    <span>
                      <span className="font-semibold text-gray-900">Arbete</span>
                      <span className="text-xs text-gray-500 block">Typ, timmar och timpris</span>
                    </span>
                  </button>
                </div>
              </>,
              document.body
            )}
          </div>

          {section.rows.length === 0 && section.laborItems.length === 0 && (
            <p className="text-xs text-gray-400 italic">
              Inga rader än — använd &quot;Lägg till rad&quot; ovan.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Material row (no price) ────────────────────────────────────────────────

function MaterialEditRow({
  row,
  onChange,
  onDelete,
}: {
  row: QuoteRow;
  onChange: (r: QuoteRow) => void;
  onDelete: () => void;
}) {
  return (
    <div className="group bg-gray-50 hover:bg-gray-100/70 rounded-lg px-2 py-1.5 transition-colors">
      <div className="grid grid-cols-[1fr_72px_72px_24px] gap-1.5 items-center text-sm">
        <input
          value={row.name}
          onChange={(e) => onChange({ ...row, name: e.target.value })}
          className="bg-white border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-green-500 text-sm min-w-0"
          placeholder="t.ex. Granbräda 28×120×4500 mm"
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
          placeholder="st"
        />
        <button
          onClick={onDelete}
          className="text-gray-300 group-hover:text-red-400 hover:!text-red-600 transition-colors"
          title="Ta bort"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Labor row ──────────────────────────────────────────────────────────────

function LaborEditRow({
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
          placeholder="t.ex. Snickeriarbete"
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
          title="Ta bort"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// Re-export for backwards-compat
export { sectionMaterialTotal };
