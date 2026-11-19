import { BookOpen, Download, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import type { DashboardSnapshot, OwnerAccount } from '../types/pharmagent.ts';

interface Props {
  token: string;
  owner: OwnerAccount;
  snapshot: DashboardSnapshot | null;
  onRefresh: () => void;
}

export default function TrainingCenter({ token, snapshot, onRefresh }: Props) {
  const [aliasForm, setAliasForm] = useState({ rawLabel: '', canonicalName: '' });
  const [colForm, setColForm] = useState({ sourceField: '', targetColumn: '' });
  const [saving, setSaving] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const memory = snapshot?.learnedMemory;

  const addAlias = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    await fetch('/api/training/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'alias', ...aliasForm }),
    });
    setAliasForm({ rawLabel: '', canonicalName: '' }); setSaving(false); onRefresh();
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
        <p className="text-slate-400 text-sm">Dictionnaire de produits et règles de colonnes apprises par l'agent</p>
      </div>

      {/* Downloads + Import */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a href={`/api/training/download/memory?token=${token}`} className="flex items-center gap-3 bg-slate-900 border border-slate-800 hover:border-emerald-500/40 rounded-xl p-4 transition-all">
          <Download size={20} className="text-emerald-400 flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-white">Mémoire Agent</div>
            <div className="text-xs text-slate-500">Alias + règles colonnes (.xlsx)</div>
          </div>
        </a>
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
            <span className="text-sm font-semibold text-white">Alias Produits</span>
            <span className="ml-auto text-xs text-slate-500">{memory?.productAliases.length ?? 0} entrées</span>
          </div>

          {/* Formulaire ajout */}
          <form onSubmit={addAlias} className="p-4 border-b border-slate-800 flex gap-2">
            <input
              value={aliasForm.rawLabel}
              onChange={(e) => setAliasForm({ ...aliasForm, rawLabel: e.target.value })}
              placeholder="Libellé brut (ex: AMOX 500)"
              required
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 outline-none"
            />
            <input
              value={aliasForm.canonicalName}
              onChange={(e) => setAliasForm({ ...aliasForm, canonicalName: e.target.value })}
              placeholder="Nom canonique (ex: Amoxicilline 500mg)"
              required
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 outline-none"
            />
            <button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white p-1.5 rounded-lg flex-shrink-0">
              <Plus size={14} />
            </button>
          </form>

          {/* Liste */}
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-800">
            {!memory?.productAliases.length ? (
              <div className="p-4 text-center text-slate-500 text-xs">Aucun alias. Ajoutez-en ci-dessus.</div>
            ) : (
              memory.productAliases.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-800/40 group">
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono text-amber-300">"{a.rawLabel}"</span>
                    <span className="text-xs text-slate-500 mx-1">→</span>
                    <span className="text-xs text-emerald-300">"{a.canonicalName}"</span>
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
