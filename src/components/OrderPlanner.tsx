// ============================================================
// PharmAgent — Commande : journal des ventes → proposition → panier pour le grossiste
// ============================================================

import { AlertTriangle, Download, Loader2, ShoppingCart, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  token: string;
  pharmacyId: string;
  canImport: boolean;
}

interface OrderLine {
  productId: string; label: string; cip?: string; soldPerDay: number; stock?: number; daysLeft?: number;
  proposed: number; purchasePrice?: number; supplier?: string; outOfStock: boolean;
}
interface SalesInfo { importedAt: string; fileName: string; periodDays: number; periodSource: 'dates' | 'saisie'; unmatched: string[] }
interface Params { coverDays: number; leadDays: number; safetyDays: number }

const input = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white focus:border-emerald-500 outline-none';
const money = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} FCFA`;

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
  r.readAsDataURL(file);
});

export default function OrderPlanner({ token, pharmacyId, canImport }: Props) {
  const [params, setParams] = useState<Params>({ coverDays: 7, leadDays: 1, safetyDays: 2 });
  const [sales, setSales] = useState<SalesInfo | null>(null);
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [periodDays, setPeriodDays] = useState('30');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(async (p: Params) => {
    if (!pharmacyId) return;
    const q = new URLSearchParams({ cover: String(p.coverDays), lead: String(p.leadDays), safety: String(p.safetyDays) });
    const r = await fetch(`/api/pharmacies/${pharmacyId}/order-proposal?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const d = await r.json() as { sales: SalesInfo | null; lines: OrderLine[] };
    setSales(d.sales); setLines(d.lines ?? []);
    setQty(Object.fromEntries((d.lines ?? []).map((l) => [l.productId, l.proposed])));
  }, [pharmacyId, token]);

  useEffect(() => { void load(params); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const importSales = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/pharmacies/${pharmacyId}/sales/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ fileBase64: await readAsDataUrl(f), fileName: f.name, periodDays: Number(periodDays) }),
      });
      const d = await r.json() as { error?: string; products?: number; periodDays?: number; unmatched?: string[] };
      if (!r.ok) { setMsg({ ok: false, text: d.error ?? 'Import impossible.' }); return; }
      setMsg({ ok: true, text: `${d.products} produits vendus sur ${d.periodDays} jours${d.unmatched?.length ? `, ${d.unmatched.length} non reconnus (voir plus bas)` : ''}.` });
      await load(params);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const basket = lines.map((l) => ({ ...l, quantity: qty[l.productId] ?? 0 })).filter((l) => l.quantity > 0);
  const total = basket.reduce((s, l) => s + l.quantity * (l.purchasePrice ?? 0), 0);

  const download = async (format: 'xlsx' | 'csv') => {
    const r = await fetch(`/api/pharmacies/${pharmacyId}/order-proposal/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ format, lines: basket.map((l) => ({ label: l.label, cip: l.cip, quantity: l.quantity })) }),
    });
    if (!r.ok) { setMsg({ ok: false, text: ((await r.json()) as { error?: string }).error ?? 'Export impossible.' }); return; }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url; a.download = `commande-${new Date().toISOString().slice(0, 10)}.${format}`; a.click();
    URL.revokeObjectURL(url);
  };

  const setParam = (k: keyof Params, v: string) => {
    const next = { ...params, [k]: Math.max(0, Math.min(120, Number(v) || 0)) };
    setParams(next); void load(next);
  };

  if (!pharmacyId) return <div className="text-slate-400 text-sm">Choisissez une officine.</div>;

  return (
    <div className="space-y-4 max-w-5xl">
      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h2 className="text-white font-semibold flex items-center gap-2"><ShoppingCart size={18} className="text-emerald-400" /> Proposition de commande</h2>
        <p className="text-xs text-slate-400 leading-relaxed">
          Besoin = ventes par jour × (couverture + délai de livraison + sécurité) − stock, arrondi à la boîte. Le stock vient du catalogue
          (Mon compte › Catalogue) : réimportez-le juste avant. Le panier est un <b>brouillon</b> : vous le vérifiez et vous passez la commande vous-même chez le grossiste.
        </p>
        {canImport && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-400">Ventes sur (jours, si le fichier n'a pas de date)
              <input value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} inputMode="numeric" className={`${input} w-24 mt-1`} />
            </label>
            <button onClick={() => file.current?.click()} disabled={busy} className="flex items-center gap-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} Importer le journal des ventes
            </button>
            <input ref={file} type="file" accept=".xlsx,.xls,.ods,.csv" className="hidden" onChange={importSales} />
          </div>
        )}
        {msg && <div className={`text-sm ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</div>}
        {sales ? (
          <div className="text-xs text-slate-400">
            Ventes importées le {new Date(sales.importedAt).toLocaleDateString('fr-FR')} ({sales.fileName || 'fichier'}) : {sales.periodDays} jours
            {sales.periodSource === 'dates' ? ' (lus sur les dates du fichier)' : ' (indiqués à l\'import)'}.
          </div>
        ) : (
          <div className="text-sm text-slate-400">Aucun journal des ventes importé. Exportez les ventes de votre logiciel (Excel ou CSV : désignation ou code CIP, quantité vendue, date).</div>
        )}
        <div className="grid grid-cols-3 gap-2 max-w-md">
          {([['coverDays', 'Couverture (j)'], ['leadDays', 'Délai livraison (j)'], ['safetyDays', 'Sécurité (j)']] as Array<[keyof Params, string]>).map(([k, label]) => (
            <label key={k} className="text-xs text-slate-400">{label}
              <input value={params[k]} onChange={(e) => setParam(k, e.target.value)} inputMode="numeric" className={`${input} mt-1`} />
            </label>
          ))}
        </div>
      </section>

      {lines.length > 0 && (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-400 text-left">
                <tr><th className="py-2 pr-2">Produit</th><th className="pr-2">Ventes/j</th><th className="pr-2">Stock</th><th className="pr-2">Jours restants</th><th className="pr-2">À commander</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.productId} className="border-t border-slate-800 text-slate-200">
                    <td className="py-2 pr-2">
                      {l.outOfStock && <AlertTriangle size={13} className="inline text-red-400 mr-1" />}{l.label}
                      {l.cip && <span className="text-[11px] text-slate-500"> · {l.cip}</span>}
                    </td>
                    <td className="pr-2">{l.soldPerDay.toLocaleString('fr-FR')}</td>
                    <td className="pr-2">{l.stock ?? <span className="text-amber-300">inconnu</span>}</td>
                    <td className="pr-2">{l.outOfStock ? <span className="text-red-300">rupture</span> : (l.daysLeft ?? '—')}</td>
                    <td className="pr-2 w-24">
                      <input value={qty[l.productId] ?? 0} inputMode="numeric" className={input}
                        onChange={(e) => setQty((q) => ({ ...q, [l.productId]: Math.max(0, Math.round(Number(e.target.value) || 0)) }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm text-slate-300 mr-auto">{basket.length} produits{total > 0 ? ` · environ ${money(total)} (prix d'achat du catalogue)` : ''}</div>
            <button onClick={() => download('xlsx')} disabled={!basket.length} className="flex items-center gap-2 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white px-4 py-2 rounded-xl"><Download size={15} /> Panier Excel</button>
            <button onClick={() => download('csv')} disabled={!basket.length} className="flex items-center gap-2 text-sm bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-xl"><Download size={15} /> Panier CSV</button>
          </div>
          <p className="text-[11px] text-slate-500">Déposez ce fichier dans l'import de commande du site du grossiste, ou envoyez-le par mail. La validation de la commande reste toujours humaine.</p>
        </section>
      )}

      {sales && sales.unmatched.length > 0 && (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
          <div className="text-sm text-amber-300 mb-2">{sales.unmatched.length} produit(s) vendus non reconnus dans le catalogue : jamais commandés automatiquement.</div>
          <div className="text-xs text-slate-400 max-h-40 overflow-y-auto">{sales.unmatched.join(' · ')}</div>
        </section>
      )}
    </div>
  );
}
