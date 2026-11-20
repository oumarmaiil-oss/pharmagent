import { BookOpen, Database, Download, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { downloadWithAuth } from './download.ts';
import { useEffect, useRef, useState } from 'react';
import type { DashboardSnapshot, OwnerAccount } from '../types/pharmagent.ts';

interface Props {
  token: string;
  owner: OwnerAccount;
  snapshot: DashboardSnapshot | null;
  onRefresh: () => void;
}

const FIELD_LABEL: Record<string, string> = {
  erpLabel: 'Désignation', cip: 'CIP', purchasePriceFCFA: 'Prix achat', salePriceFCFA: 'Prix vente', stockQty: 'Stock',
};

export default function TrainingCenter({ token, snapshot, onRefresh }: Props) {
  const [colForm, setColForm] = useState({ sourceField: '', targetColumn: '' });
  const [saving, setSaving] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const pharmacies = snapshot?.pharmacies ?? [];
  const [catalogPharmacy, setCatalogPharmacy] = useState('');
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogMsg, setCatalogMsg] = useState('');
  const catalogRef = useRef<HTMLInputElement>(null);
  const phId = catalogPharmacy || pharmacies[0]?.id || '';

  useEffect(() => {
    if (!phId) return;
    setCatalogTotal(null); setCatalogMsg('');
    fetch(`/api/pharmacies/${phId}/catalog`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d: { total?: number }) => setCatalogTotal(d.total ?? 0))
      .catch(() => setCatalogTotal(null));
  }, [phId, token]);

  const memory = snapshot?.learnedMemory;
  const phName = (id?: string) => pharmacies.find((p) => p.id === id)?.name;

  const importCatalog = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !phId) return;
    setCatalogLoading(true); setCatalogMsg('');
    try {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const r = await fetch(`/api/pharmacies/${phId}/catalog/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fileBase64 }),
      });
      const d = await r.json() as { added?: number; updated?: number; total?: number; columns?: Record<string, string>; error?: string };
      if (!r.ok) { setCatalogMsg(d.error ?? 'Erreur import.'); return; }
      const cols = Object.entries(d.columns ?? {}).map(([k, v]) => `${FIELD_LABEL[k]} ← « ${v} »`).join(', ');
      setCatalogMsg(`✓ ${d.added} ajoutés, ${d.updated} mis à jour. Colonnes : ${cols}`);
      setCatalogTotal(d.total ?? null);
    } catch {
      setCatalogMsg('Fichier illisible.');
    } finally {
      setCatalogLoading(false);
    }
  };

  const addColumn = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    await fetch('/api/training/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'column', ...colForm }),
    });
    setColForm({ sourceField: '', targetColumn: '' }); setSaving(false); onRefresh();
  };

  const deleteRule = async (id: string, type: 'alias' | 'column') => {
    await fetch(`/api/training/rules/${id}?type=${type}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    onRefresh();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true); setImportMsg('');
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const r = await fetch('/api/training/import-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(json),
      });
      const data = await r.json() as { ok?: boolean; error?: string };
      setImportMsg(data.ok ? '✓ Mémoire importée avec succès.' : (data.error ?? 'Erreur.'));
      if (data.ok) onRefresh();
    } catch {
      setImportMsg('Fichier invalide (JSON attendu).');
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white">Mémoire & Entraînement</h1>
        <p className="text-slate-400 text-sm">Catalogue ERP de chaque officine et correspondances apprises automatiquement</p>
      </div>

      {/* Catalogue ERP */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Database size={16} className="text-emerald-400" />
          <span className="text-sm font-semibold text-white">Catalogue produits ERP</span>
          <select
            value={phId}
            onChange={(e) => setCatalogPharmacy(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white outline-none"
          >
            {pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="text-xs text-slate-400 ml-auto">
            {catalogTotal === null ? '…' : `${catalogTotal.toLocaleString('fr-FR')} produits`}
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Exportez la liste des produits depuis l'ERP (Excel ou CSV) et importez-la une fois. Les colonnes
          désignation, CIP, prix d'achat, prix de vente et stock sont détectées automatiquement.
          L'agent local complète ensuite ce catalogue tout seul à chaque recherche dans l'ERP.
        </p>
        <input ref={catalogRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importCatalog} />
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => catalogRef.current?.click()}
            disabled={catalogLoading || !phId}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {catalogLoading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Importer le catalogue
          </button>
          {catalogMsg && <span className={`text-xs ${catalogMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{catalogMsg}</span>}
        </div>
      </div>

      {/* Downloads + Import */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button onClick={() => void downloadWithAuth('/api/training/download/memory', token, 'memoire.json')} className="flex items-center gap-3 bg-slate-900 border border-slate-800 hover:border-emerald-500/40 rounded-xl p-4 transition-all">
          <Download size={20} className="text-emerald-400 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-white">Mémoire Agent</div>
            <div className="text-xs text-slate-500">Alias + règles colonnes (.xlsx)</div>
          </div>
        </button>
        <a href="/api/training/download/target" className="flex items-center gap-3 bg-slate-900 border border-slate-800 hover:border-blue-500/40 rounded-xl p-4 transition-all">
          <Download size={20} className="text-blue-400 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-white">Modèle Cible Stock</div>
            <div className="text-xs text-slate-500">Colonnes de réception (.xlsx)</div>
          </div>
        </a>
        <a href="/api/training/download/custom_kit" className="flex items-center gap-3 bg-slate-900 border border-slate-800 hover:border-purple-500/40 rounded-xl p-4 transition-all">
          <Download size={20} className="text-purple-400 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-white">Kit Test Officine</div>
            <div className="text-xs text-slate-500">Fichier de test personnalisé (.xlsx)</div>
          </div>
        </a>
      </div>

      {/* Import JSON */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-3 mb-2">
          <Upload size={16} className="text-slate-400" />
          <span className="text-sm font-medium text-white">Importer une mémoire (JSON)</span>
        </div>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
        <div className="flex items-center gap-3">
          <button onClick={() => fileRef.current?.click()} disabled={importLoading} className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm px-4 py-2 rounded-lg disabled:opacity-50">
            {importLoading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Choisir un fichier .json
          </button>
          {importMsg && <span className={`text-xs ${importMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{importMsg}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alias produits */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
            <BookOpen size={15} className="text-emerald-400" />
            <span className="text-sm font-semibold text-white">Correspondances apprises</span>
            <span className="ml-auto text-xs text-slate-500">{memory?.productAliases.length ?? 0} entrées</span>
          </div>
          <div className="px-4 py-2 border-b border-slate-800 text-[11px] text-slate-500">
            Ajoutées automatiquement quand un brouillon est approuvé ou qu'une ligne est corrigée.
          </div>

          {/* Liste */}
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
            {!memory?.productAliases.length ? (
              <div className="p-4 text-center text-slate-500 text-xs">Aucune correspondance encore. Elles s'accumulent à chaque brouillon validé.</div>
            ) : (
              memory.productAliases.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-800/40 group">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono text-amber-300">"{a.rawLabel}"</span>
                    <span className="text-xs text-slate-500 mx-1">→</span>
                    <span className="text-xs text-emerald-300">"{a.canonicalName}"</span>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {[a.supplier && `Grossiste ${a.supplier}`, phName(a.pharmacyId), a.hits && `${a.hits}×`].filter(Boolean).join(' · ') || 'Toutes officines'}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteRule(a.id, 'alias')}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-0.5"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Règles colonnes */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
            <BookOpen size={15} className="text-blue-400" />
            <span className="text-sm font-semibold text-white">Règles de Colonnes</span>
            <span className="ml-auto text-xs text-slate-500">{memory?.columnRules.length ?? 0} règles</span>
          </div>

          {/* Formulaire ajout */}
          <form onSubmit={addColumn} className="p-4 border-b border-slate-800 flex gap-2">
            <input
              value={colForm.sourceField}
              onChange={(e) => setColForm({ ...colForm, sourceField: e.target.value })}
              placeholder="Champ source (ex: item.quantity)"
              required
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 outline-none"
            />
            <input
              value={colForm.targetColumn}
              onChange={(e) => setColForm({ ...colForm, targetColumn: e.target.value })}
              placeholder="Colonne cible (ex: Quantité Reçue)"
              required
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 outline-none"
            />
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-500 text-white p-1.5 rounded-lg flex-shrink-0">
              <Plus size={14} />
            </button>
          </form>

          {/* Liste */}
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
            {!memory?.columnRules.length ? (
              <div className="p-4 text-center text-slate-500 text-xs">Aucune règle. Ajoutez-en ci-dessus.</div>
            ) : (
              memory.columnRules.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-800/40 group">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono text-blue-300">"{r.sourceField}"</span>
                    <span className="text-xs text-slate-500 mx-1">→</span>
                    <span className="text-xs text-slate-200">"{r.targetColumn}"</span>
                  </div>
                  <button
                    onClick={() => deleteRule(r.id, 'column')}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-0.5"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
