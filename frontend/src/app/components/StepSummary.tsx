"use client";

import { useState } from "react";
import { Download, Loader2, FileText } from "lucide-react";
import {
  Quote,
  fmt,
  rowPrice,
  rowSelectedStore,
  sectionLaborTotal,
  sectionMaterialTotal,
  quoteGrandTotal,
} from "./QuotePanel";

export default function StepSummary({
  quote,
  projectName,
  description,
  backend,
  onBack,
}: {
  quote: Quote;
  projectName: string;
  description: string;
  backend: string;
  onBack: () => void;
}) {
  const [builder, setBuilder] = useState("");
  const [customer, setCustomer] = useState("");
  const [downloading, setDownloading] = useState(false);

  const grand = quoteGrandTotal(quote);
  const vat = grand * 0.25;
  const incVat = grand + vat;

  async function downloadPdf() {
    setDownloading(true);
    try {
      const items: {
        description: string;
        quantity: string;
        unit: string;
        unit_price: number;
        total: number;
      }[] = [];
      for (const s of quote.sections) {
        for (const r of s.rows) {
          if (r.qty <= 0) continue;
          const sel = rowSelectedStore(r);
          const desc =
            `${s.name} — ${r.name}` +
            (sel ? ` (${sel.name})` : r.url ? ` (länk)` : "");
          const price = rowPrice(r);
          items.push({
            description: desc,
            quantity: String(r.qty),
            unit: r.unit,
            unit_price: price,
            total: r.qty * price,
          });
        }
        for (const l of s.laborItems) {
          if (l.hours <= 0) continue;
          items.push({
            description: `${s.name} — ${l.name}`,
            quantity: String(l.hours),
            unit: "h",
            unit_price: l.rate,
            total: l.hours * l.rate,
          });
        }
      }

      const body = {
        builder_name: builder || projectName || "Majstor",
        customer_name: customer || "Kund",
        job_description: description || projectName,
        items,
        notes: "Ponuda är preliminär. Genererad av Majstor AI.",
      };

      const res = await fetch(`${backend}/api/pdf/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`PDF error: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName || "ponuda"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Kunde inte generera PDF: ${(err as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto w-full p-6 space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">
          Steg 4 — Sammanställning
        </h2>
        <p className="text-sm text-gray-500">
          Granska totalen och ladda ner offerten som PDF.
        </p>
      </div>

      {/* Customer / builder */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700">Offert-uppgifter</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Hantverkare / Företag
            </label>
            <input
              value={builder}
              onChange={(e) => setBuilder(e.target.value)}
              placeholder="t.ex. Majstor Ante AB"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Kund
            </label>
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="t.ex. Familjen Krečić"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {quote.sections.map((s) => {
          const matTotal = sectionMaterialTotal(s);
          const labTotal = sectionLaborTotal(s);
          const sectionTotal = matTotal + labTotal;
          return (
            <div
              key={s.id}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden"
            >
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                <h3 className="font-bold text-gray-900">{s.name}</h3>
                <span className="font-bold text-green-700 text-sm">
                  {fmt(sectionTotal)} kr
                </span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {s.rows.map((r) => {
                    const price = rowPrice(r);
                    const sel = rowSelectedStore(r);
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-gray-100 last:border-0"
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900">
                            {r.name}
                          </div>
                          {sel && (
                            <div className="text-xs text-gray-500">
                              {sel.name}
                              {sel.url && (
                                <>
                                  {" · "}
                                  <a
                                    href={sel.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline"
                                  >
                                    visa
                                  </a>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2.5 text-center text-gray-600 whitespace-nowrap">
                          {r.qty} {r.unit}
                        </td>
                        <td className="px-2 py-2.5 text-right text-gray-600 whitespace-nowrap">
                          {fmt(price)} kr
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">
                          {fmt(r.qty * price)} kr
                        </td>
                      </tr>
                    );
                  })}
                  {s.laborItems.map((l) => (
                    <tr
                      key={l.id}
                      className="border-b border-gray-100 last:border-0 bg-amber-50/30"
                    >
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900">
                          {l.name}
                        </div>
                        <div className="text-xs text-amber-700">Arbete</div>
                      </td>
                      <td className="px-2 py-2.5 text-center text-gray-600 whitespace-nowrap">
                        {l.hours} h
                      </td>
                      <td className="px-2 py-2.5 text-right text-gray-600 whitespace-nowrap">
                        {fmt(l.rate)} kr/h
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900 whitespace-nowrap">
                        {fmt(l.hours * l.rate)} kr
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1.5">
        <div className="flex justify-between text-sm text-gray-600">
          <span>Summa exkl. moms</span>
          <span>{fmt(grand)} kr</span>
        </div>
        <div className="flex justify-between text-sm text-gray-600">
          <span>Moms 25%</span>
          <span>{fmt(vat)} kr</span>
        </div>
        <div className="flex justify-between font-bold text-green-700 text-lg pt-1.5 border-t border-gray-100">
          <span>Totalt inkl. moms</span>
          <span>{fmt(incVat)} kr</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          ← Tillbaka
        </button>
        <button
          onClick={downloadPdf}
          disabled={downloading || quote.sections.length === 0}
          className="bg-green-700 hover:bg-green-800 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2"
        >
          {downloading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Download size={16} />
          )}
          Ladda ner PDF
        </button>
      </div>

      <div className="text-xs text-gray-400 text-center pt-2 flex items-center justify-center gap-1">
        <FileText size={11} /> PDF skapas av Majstor AI
      </div>
    </div>
  );
}
