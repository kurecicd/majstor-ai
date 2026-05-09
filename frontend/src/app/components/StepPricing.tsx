"use client";

import { useState, useEffect, useRef } from "react";
import {
  Loader2,
  ExternalLink,
  Check,
  Search,
  Link2,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import {
  Quote,
  QuoteRow,
  QuoteSection,
  StoreOption,
  fmt,
  rowSelectedStore,
} from "./QuotePanel";

interface SearchHit {
  store: string;
  search_url: string;
  name?: string | null;
  price?: number | null;
  url?: string | null;
  image?: string | null;
  error?: string | null;
}

interface SearchResponse {
  query: string;
  results: SearchHit[];
}

export default function StepPricing({
  quote,
  onChange,
  backend,
  onBack,
  onContinue,
}: {
  quote: Quote;
  onChange: (q: Quote) => void;
  backend: string;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [searchingAll, setSearchingAll] = useState(false);
  const autoSearched = useRef(false);
  // Always read the latest quote — avoids stale-closure bug when many
  // parallel searches complete and each overwrites the others' results.
  const quoteRef = useRef(quote);
  quoteRef.current = quote;

  function saveToLibrary(query: string, store: string, name: string, price: number, url: string) {
    fetch(`${backend}/api/library`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, store, name, price, url }),
    }).catch(() => {});
  }

  // Always re-search all rows when entering Step 3 — ensures fresh results
  // even for rows that were searched in a previous session
  useEffect(() => {
    if (autoSearched.current) return;
    autoSearched.current = true;
    const hasMaterial = quote.sections.some((s) => s.rows.some((r) => r.name.trim()));
    if (hasMaterial) {
      setSearchingAll(true);
      const tasks: Promise<unknown>[] = [];
      quote.sections.forEach((s, si) => {
        s.rows.forEach((r, ri) => {
          if (r.name.trim()) tasks.push(searchRow(si, ri));
        });
      });
      Promise.all(tasks).finally(() => setSearchingAll(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (sIdx: number, rIdx: number, r: QuoteRow) => {
    // Read from ref — always the latest state, safe to call from async callbacks
    const current = quoteRef.current;
    const sections = [...current.sections];
    const section = { ...sections[sIdx] };
    const rows = [...section.rows];
    rows[rIdx] = r;
    section.rows = rows;
    sections[sIdx] = section;
    onChange({ sections });
  };

  async function searchRow(sIdx: number, rIdx: number) {
    const row = quoteRef.current.sections[sIdx]?.rows[rIdx];
    if (!row?.name.trim()) return;
    try {
      const res = await fetch(`${backend}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: row.name }),
      });
      const data = (await res.json()) as SearchResponse;
      mergeHits(sIdx, rIdx, data.results);
    } catch {
      const current = quoteRef.current.sections[sIdx]?.rows[rIdx];
      if (current) updateRow(sIdx, rIdx, { ...current, searched: true });
    }
  }

  function mergeHits(sIdx: number, rIdx: number, hits: SearchHit[]) {
    const row = quoteRef.current.sections[sIdx].rows[rIdx];
    const newStores: StoreOption[] = [...row.stores];
    for (const h of hits) {
      const existingIdx = newStores.findIndex(
        (s) => s.name.toLowerCase() === h.store.toLowerCase()
      );
      const opt: StoreOption = {
        name: h.store,
        price: h.price ?? 0,
        url: h.url ?? h.search_url,
        source: h.name ?? (h.error ? `Klicka för att söka: ${h.store}` : h.store),
        image: h.image ?? undefined,
      };
      if (existingIdx >= 0) newStores[existingIdx] = opt;
      else newStores.push(opt);
    }

    // Auto-select cheapest store — user can override by clicking Välj on another
    let selectedIdx = row.selectedStoreIdx;
    if (selectedIdx < 0 || selectedIdx >= newStores.length) {
      // No selection yet — pick cheapest with a price
      let bestIdx = -1;
      let bestPrice = Infinity;
      newStores.forEach((s, i) => {
        if (s.price > 0 && s.price < bestPrice) { bestPrice = s.price; bestIdx = i; }
      });
      selectedIdx = bestIdx;
    }

    updateRow(sIdx, rIdx, {
      ...row,
      stores: newStores,
      searched: true,
      selectedStoreIdx: selectedIdx,
      manualPrice: selectedIdx >= 0 ? (newStores[selectedIdx]?.price ?? row.manualPrice) : row.manualPrice,
    });
  }

  async function searchAll() {
    setSearchingAll(true);
    const tasks: Promise<unknown>[] = [];
    quote.sections.forEach((s, si) => {
      s.rows.forEach((r, ri) => {
        if (!r.searched && r.name.trim()) {
          tasks.push(searchRow(si, ri));
        }
      });
    });
    await Promise.all(tasks);
    setSearchingAll(false);
  }

  return (
    <div className="max-w-3xl mx-auto w-full p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            Steg 3 — Pris och butik
          </h2>
          <p className="text-sm text-gray-500">
            Priser hämtas automatiskt. Klicka på butikslänken för att verifiera produkten, välj sedan.
          </p>
        </div>
        <button
          onClick={searchAll}
          disabled={searchingAll}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5 shrink-0"
        >
          {searchingAll ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Search size={14} />
          )}
          Hämta alla priser
        </button>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {quote.sections.map((s, si) => (
          <PricingSection
            key={s.id}
            section={s}
            backend={backend}
            onSearchRow={(ri) => searchRow(si, ri)}
            onPickStore={(ri, storeIdx) => {
              const row = s.rows[ri];
              const store = row.stores[storeIdx];
              updateRow(si, ri, {
                ...row,
                selectedStoreIdx: storeIdx,
                manualPrice: store?.price ?? row.manualPrice,
              });
              if (store && store.price > 0) {
                saveToLibrary(row.name, store.name, store.source || store.name, store.price, store.url || "");
              }
            }}
            onSetManual={(ri, price) => {
              const row = s.rows[ri];
              updateRow(si, ri, { ...row, selectedStoreIdx: -1, manualPrice: price });
            }}
            onAddManualLink={(ri, opt) => {
              const row = s.rows[ri];
              const stores = [...row.stores, opt];
              updateRow(si, ri, { ...row, stores, selectedStoreIdx: stores.length - 1, manualPrice: opt.price });
            }}
            onReplaceStore={(ri, storeIdx, opt) => {
              const row = s.rows[ri];
              const stores = [...row.stores];
              stores[storeIdx] = opt;
              updateRow(si, ri, { ...row, stores, selectedStoreIdx: storeIdx, manualPrice: opt.price || row.manualPrice });
            }}
          />
        ))}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <button
          onClick={onBack}
          className="px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          ← Tillbaka
        </button>
        <button
          onClick={onContinue}
          className="bg-green-700 hover:bg-green-800 text-white px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2"
        >
          Sammanställning <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Section ────────────────────────────────────────────────────────────────

function PricingSection({
  section,
  backend,
  onSearchRow,
  onPickStore,
  onSetManual,
  onAddManualLink,
  onReplaceStore,
}: {
  section: QuoteSection;
  backend: string;
  onSearchRow: (rowIdx: number) => Promise<void>;
  onPickStore: (rowIdx: number, storeIdx: number) => void;
  onSetManual: (rowIdx: number, price: number) => void;
  onAddManualLink: (rowIdx: number, opt: StoreOption) => void;
  onReplaceStore: (rowIdx: number, storeIdx: number, opt: StoreOption) => void;
}) {
  if (section.rows.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 bg-gradient-to-r from-gray-50 to-white border-b">
        <h3 className="font-bold text-gray-900">{section.name}</h3>
      </div>
      <div className="p-3 space-y-3">
        {section.rows.map((r, ri) => (
          <PricingRow
            key={r.id}
            row={r}
            backend={backend}
            onSearch={() => onSearchRow(ri)}
            onPick={(idx) => onPickStore(ri, idx)}
            onSetManual={(p) => onSetManual(ri, p)}
            onAddManualLink={(opt) => onAddManualLink(ri, opt)}
            onReplaceStore={(idx, opt) => onReplaceStore(ri, idx, opt)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

function PricingRow({
  row,
  backend,
  onSearch,
  onPick,
  onSetManual,
  onAddManualLink,
  onReplaceStore,
}: {
  row: QuoteRow;
  backend: string;
  onSearch: () => Promise<void>;
  onPick: (storeIdx: number) => void;
  onSetManual: (price: number) => void;
  onAddManualLink: (opt: StoreOption) => void;
  onReplaceStore: (storeIdx: number, opt: StoreOption) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualPrice, setManualPrice] = useState(row.manualPrice || 0);

  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkStore, setLinkStore] = useState("");
  const [linkPrice, setLinkPrice] = useState(0);

  async function doSearch() {
    setSearching(true);
    try {
      await onSearch();
    } finally {
      setSearching(false);
    }
  }

  const sel = rowSelectedStore(row);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 bg-gray-50 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-900 truncate">
            {row.name || "Namnlös vara"}
          </div>
          <div className="text-xs text-gray-500">
            {row.qty} {row.unit}
            {sel && (
              <>
                {" · "}
                <span className="text-green-700 font-semibold">{sel.name}</span>{" "}
                <span className="font-semibold">{fmt(sel.price)} kr</span>
              </>
            )}
          </div>
        </div>
        {/* While searching: spinner. After searched: small refresh icon. Never a big blue button. */}
        {searching ? (
          <Loader2 size={15} className="animate-spin text-blue-500 shrink-0" />
        ) : !row.searched ? (
          <Loader2 size={15} className="animate-spin text-gray-300 shrink-0" />
        ) : (
          <button
            onClick={doSearch}
            className="text-gray-400 hover:text-blue-600 shrink-0 text-xs px-1"
            title="Sök igen"
          >
            ↻
          </button>
        )}
      </div>

      {/* Store options */}
      {row.stores.length > 0 && (
        <div className="p-2 space-y-1.5">
          {row.stores.map((s, i) => (
            <StoreCard
              key={i}
              option={s}
              selected={row.selectedStoreIdx === i}
              backend={backend}
              onPick={() => onPick(i)}
              onReplace={(opt) => onReplaceStore(i, opt)}
            />
          ))}
        </div>
      )}

      {row.searched && row.stores.length === 0 && (
        <div className="p-3 text-xs text-amber-700 bg-amber-50 flex items-center gap-2">
          <AlertCircle size={13} /> Inga butiker svarade. Använd manuellt pris
          eller egen länk nedan.
        </div>
      )}

      {/* Manual + link buttons */}
      <div className="px-3 py-2 border-t border-gray-100 flex flex-wrap gap-2 text-xs">
        <button
          onClick={() => {
            setShowManual((v) => !v);
            setShowLink(false);
          }}
          className={`px-2.5 py-1 rounded-lg border transition-colors ${
            showManual || row.selectedStoreIdx === -1 && row.manualPrice > 0
              ? "border-green-500 text-green-700 bg-green-50"
              : "border-gray-200 text-gray-600 hover:border-gray-400"
          }`}
        >
          Manuellt pris
        </button>
        <button
          onClick={() => {
            setShowLink((v) => !v);
            setShowManual(false);
          }}
          className={`px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1 ${
            showLink ? "border-blue-500 text-blue-700 bg-blue-50" : "border-gray-200 text-gray-600 hover:border-gray-400"
          }`}
        >
          <Link2 size={11} /> Egen länk
        </button>
      </div>

      {showManual && (
        <div className="px-3 pb-3 flex items-center gap-2">
          <input
            type="number"
            value={manualPrice || ""}
            onChange={(e) => setManualPrice(parseFloat(e.target.value) || 0)}
            placeholder="kr / enhet"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            onClick={() => {
              onSetManual(manualPrice);
              setShowManual(false);
            }}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold"
          >
            Spara
          </button>
        </div>
      )}

      {showLink && (
        <div className="px-3 pb-3 space-y-2">
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://www.bauhaus.se/..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={linkStore}
              onChange={(e) => setLinkStore(e.target.value)}
              placeholder="Butik"
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="number"
              value={linkPrice || ""}
              onChange={(e) => setLinkPrice(parseFloat(e.target.value) || 0)}
              placeholder="Pris kr"
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
            />
          </div>
          <button
            onClick={() => {
              if (!linkUrl) return;
              onAddManualLink({
                name: linkStore || "Egen",
                price: linkPrice,
                url: linkUrl,
                source: linkUrl,
              });
              setShowLink(false);
              setLinkUrl("");
              setLinkStore("");
              setLinkPrice(0);
            }}
            disabled={!linkUrl}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white py-2 rounded-lg text-sm font-semibold"
          >
            Spara länk som källa
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Store card ─────────────────────────────────────────────────────────────

function StoreCard({
  option,
  selected,
  backend,
  onPick,
  onReplace,
}: {
  option: StoreOption;
  selected: boolean;
  backend: string;
  onPick: () => void;
  onReplace: (opt: StoreOption) => void;
}) {
  const hasPrice = option.price > 0;
  const [customUrl, setCustomUrl] = useState("");
  const [fetching, setFetching] = useState(false);

  async function applyUrl(url: string) {
    if (!url.trim()) return;
    setFetching(true);
    try {
      const res = await fetch(`${backend}/api/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      onReplace({
        name: option.name,
        price: data.price || option.price || 0,
        url: url.trim(),
        source: data.name || url.trim(),
      });
      setCustomUrl("");
      onPick();
    } catch {
      // If scrape fails, just update the URL manually
      onReplace({ ...option, url: url.trim(), source: url.trim() });
      setCustomUrl("");
      onPick();
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className={`rounded-lg border transition-colors ${selected ? "border-green-500 bg-green-50" : "border-gray-200"}`}>
      {/* Main row */}
      <div className="flex items-center gap-2 p-2.5">
        <div
          className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${
            selected ? "border-green-600 bg-green-600" : "border-gray-300"
          }`}
        >
          {selected && <Check size={12} className="text-white" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-gray-900">{option.name}</span>
            {hasPrice && (
              <span className="font-bold text-gray-900 shrink-0">{fmt(option.price)} kr</span>
            )}
          </div>
          {/* Product name = the link. Always visible, always clickable. */}
          <a
            href={option.url || "#"}
            target={option.url ? "_blank" : undefined}
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-sm text-blue-600 hover:text-blue-800 underline block mt-0.5 truncate"
          >
            {option.source && option.source !== option.name
              ? option.source
              : option.name}
          </a>
        </div>

        <button
          onClick={onPick}
          disabled={selected}
          className={`text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 ${
            selected ? "bg-green-600 text-white" : "bg-gray-900 text-white hover:bg-gray-700"
          }`}
        >
          {selected ? "Vald" : "Välj"}
        </button>
      </div>

      {/* URL paste — replace with a different product */}
      <div className="px-2.5 pb-2.5 flex items-center gap-1.5">
        <input
          type="url"
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyUrl(customUrl)}
          onPaste={(e) => {
            const url = e.clipboardData.getData("text").trim();
            if (url.startsWith("http")) {
              e.preventDefault();
              setCustomUrl(url);
              applyUrl(url);
            }
          }}
          placeholder="Klistra in rätt produkt-URL…"
          className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
        />
        {customUrl && (
          <button
            onClick={() => applyUrl(customUrl)}
            disabled={fetching}
            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1.5 rounded shrink-0"
          >
            {fetching ? <Loader2 size={11} className="animate-spin" /> : "OK"}
          </button>
        )}
      </div>
    </div>
  );
}
