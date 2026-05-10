// Types and helpers shared by every step in the wizard.

export interface StoreOption {
  name: string;
  price: number;
  source?: string;
  url?: string;
  is_product_url?: boolean;
  image?: string;
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
  searched?: boolean; // whether live search has been attempted
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

let _uid = 0;
export const uid = () => `${++_uid}`;

export const fmt = (n: number) => Math.round(n).toLocaleString("sv-SE");

export function rowPrice(r: QuoteRow): number {
  if (r.selectedStoreIdx >= 0 && r.stores[r.selectedStoreIdx]) {
    return r.stores[r.selectedStoreIdx].price;
  }
  return r.manualPrice;
}

export function rowSelectedStore(r: QuoteRow): StoreOption | null {
  if (r.selectedStoreIdx >= 0 && r.stores[r.selectedStoreIdx]) {
    return r.stores[r.selectedStoreIdx];
  }
  return null;
}

export function sectionMaterialTotal(s: QuoteSection): number {
  return s.rows.reduce((a, r) => a + r.qty * rowPrice(r), 0);
}

export function sectionLaborTotal(s: QuoteSection): number {
  return s.laborItems.reduce((a, l) => a + l.hours * l.rate, 0);
}

export function quoteGrandTotal(q: Quote): number {
  return q.sections.reduce(
    (t, s) => t + sectionMaterialTotal(s) + sectionLaborTotal(s),
    0
  );
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
                name: (l.name as string) ?? "Arbete",
                hours: Number(l.hours) || 0,
                rate: Number(l.rate) || 450,
              }))
            : [];
        return {
          id: uid(),
          name: (s.name as string) ?? "Sektion",
          collapsed: false,
          laborItems,
          rows: ((s.items as Record<string, unknown>[]) ?? []).map((it) => {
            const stores: StoreOption[] = Array.isArray(it.stores)
              ? (it.stores as Record<string, unknown>[]).map((st) => ({
                  name: (st.name as string) ?? "Butik",
                  price: Number(st.price) || 0,
                  source: (st.source as string) || undefined,
                  url: (st.url as string) || undefined,
                }))
              : [];
            return {
              id: uid(),
              name: (it.name as string) ?? "",
              qty: Number(it.qty) || 1,
              unit: (it.unit as string) ?? "st",
              stores,
              selectedStoreIdx: -1,
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
