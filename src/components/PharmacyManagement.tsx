import { Building2, ChevronDown, ChevronUp, Download, Loader2, Plus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import PharmacyAdmin, { SOFTWARE_OPTIONS } from './PharmacyAdmin.tsx';
import type { DashboardSnapshot, OwnerAccount, TargetSoftwareType } from '../types/pharmagent.ts';

interface Props {
  token: string;
  owner: OwnerAccount;
  snapshot: DashboardSnapshot | null;
  onRefresh: () => void;
  selectedPharmacyId: string;
  onSelectPharmacy: (id: string) => void;
}


export default function PharmacyManagement({ token, snapshot, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<{ name: string; code: string; password: string } | null>(null);
  const [form, setForm] = useState({ name: '', city: '', region: '', pharmacist: '', targetSoftware: SOFTWARE_OPTIONS[0] as TargetSoftwareType });

  const pharmacies = snapshot?.pharmacies ?? [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const r = await fetch('/api/pharmacies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await r.json() as { pharmacy?: { name: string }; credentials?: { code: string; password: string }; error?: string };
      if (!r.ok || !data.pharmacy) { setError(data.error ?? 'Erreur création.'); return; }
      if (data.credentials) setCredentials({ name: data.pharmacy.name, ...data.credentials });
      setShowForm(false);
      setForm({ name: '', city: '', region: '', pharmacist: '', targetSoftware: SOFTWARE_OPTIONS[0] });
      onRefresh();
    } catch {
      setError('Erreur réseau.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <BackupCard token={token} />

      {credentials && (
        // Fenêtre au centre de l'écran : impossible de manquer le mot de passe, où que l'on ait cliqué
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-emerald-500/40 bg-slate-900 p-5 space-y-3 shadow-2xl">
            <div className="text-base font-semibold text-white">Connexion de {credentials.name}</div>
            <p className="text-xs text-slate-400">Sur l'écran de connexion, tapez simplement ces deux informations (majuscules ou minuscules).</p>
            <div className="rounded-xl bg-slate-950 border border-slate-700 p-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><span className="text-slate-400">Identifiant</span><span className="font-mono font-bold tracking-widest text-emerald-300" data-testid="cred-code">{credentials.code}</span></div>
              <div className="flex justify-between gap-3"><span className="text-slate-400">Mot de passe</span><span className="font-mono font-bold tracking-wider text-emerald-300" data-testid="cred-password">{credentials.password}</span></div>
            </div>
            <p className="text-xs text-amber-300">Notez-le maintenant : il ne sera plus affiché. Le pharmacien peut le changer ensuite dans « Mon compte ».</p>
            <div className="flex gap-2">
              <button
                onClick={() => { void navigator.clipboard?.writeText(`Identifiant : ${credentials.code}\nMot de passe : ${credentials.password}`); }}
                className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm py-2 rounded-lg"
              >Copier</button>
              <button onClick={() => setCredentials(null)} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-2 rounded-lg">J'ai noté</button>
            </div>
          </div>
        </div>
      )}

      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Mes Officines</h1>
          <p className="text-slate-400 text-sm">{pharmacies.length} officine{pharmacies.length > 1 ? 's' : ''} enregistrée{pharmacies.length > 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          <Plus size={16} />
          Nouvelle officine
        </button>
      </div>

      {/* Formulaire de création */}
      {showForm && (
        <div className="bg-slate-900 border border-emerald-500/30 rounded-xl p-5 animate-in">
          <h2 className="text-sm font-semibold text-white mb-4">➕ Nouvelle officine</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Nom de l'officine *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Pharmacie du Centre" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Titulaire *</label>
              <input value={form.pharmacist} onChange={(e) => setForm({ ...form, pharmacist: e.target.value })} required placeholder="Dr. Nom Prénom" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Ville *</label>
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required placeholder="Dakar" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Région</label>
              <input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="Dakar" className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-400 mb-1">Logiciel cible</label>
              <select value={form.targetSoftware} onChange={(e) => setForm({ ...form, targetSoftware: e.target.value as TargetSoftwareType })} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none">
                {SOFTWARE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {error && <div className="md:col-span-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-lg">{error}</div>}
            <div className="md:col-span-2 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="text-sm text-slate-400 hover:text-white px-4 py-2">Annuler</button>
              <button type="submit" disabled={loading} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg">
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                Créer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Liste des officines */}
      {pharmacies.length === 0 ? (
        <div className="bg-slate-900 border border-dashed border-slate-700 rounded-xl p-12 text-center">
          <Building2 size={40} className="text-slate-700 mx-auto mb-3" />
          <p className="text-slate-500">Aucune officine. Cliquez sur "Nouvelle officine" pour commencer.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pharmacies.map((ph) => {
            const stat = snapshot?.stats.find((s) => s.pharmacyId === ph.id);
            const isOpen = expandedId === ph.id;
            return (
              <div key={ph.id} className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-slate-800/40"
                  onClick={() => setExpandedId(isOpen ? null : ph.id)}
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                    <Building2 size={18} className="text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-white">{ph.name}</div>
                    <div className="text-xs text-slate-500">{ph.city} · {ph.targetSoftware} · {ph.pharmacist}</div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 text-xs">
                    {(stat?.pendingDrafts ?? 0) > 0 && (
                      <span className="badge-pending px-2 py-0.5 rounded-full">{stat!.pendingDrafts} en attente</span>
                    )}
                    <span className="text-slate-500 mono text-xs">{ph.usedThisMonth}/{ph.monthlyQuota}</span>
                    {isOpen ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
                  </div>
                </div>

                {isOpen && (
                  <PharmacyAdmin key={ph.id} ph={ph} token={token} onChanged={onRefresh}
                    onCredentials={(c) => setCredentials({ name: c.account === 'equipe' ? `${c.name} — compte Équipe` : c.name, code: c.code, password: c.password })} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BackupCard({ token }: { token: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const download = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/owner/backup', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { setMsg({ ok: false, text: 'Sauvegarde impossible.' }); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url; a.download = `pharmagent-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      setMsg({ ok: true, text: 'Sauvegarde téléchargée. Gardez ce fichier en lieu sûr : il contient les comptes et les clés des agents.' });
    } catch {
      setMsg({ ok: false, text: 'Connexion impossible.' });
    } finally {
      setBusy(false);
    }
  };

  const restore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !window.confirm('Remplacer TOUTES les données actuelles par cette sauvegarde ?')) return;
    setBusy(true); setMsg(null);
    try {
      const data = JSON.parse(await file.text()) as unknown;
      const r = await fetch('/api/owner/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ data }),
      });
      const d = await r.json() as { pharmacies?: number; drafts?: number; error?: string };
      if (!r.ok) { setMsg({ ok: false, text: d.error ?? 'Restauration impossible.' }); return; }
      setMsg({ ok: true, text: `Restauré : ${d.pharmacies} officine(s), ${d.drafts} brouillon(s). Rechargez la page et reconnectez-vous si besoin.` });
    } catch {
      setMsg({ ok: false, text: 'Fichier de sauvegarde illisible.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
      <div className="text-sm font-semibold text-white">Sauvegarde des données</div>
      <p className="text-xs text-slate-400">La base gratuite expire 30 jours après sa création. Avant cette date : téléchargez une sauvegarde, créez une nouvelle base, puis restaurez la sauvegarde ici.</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={download} disabled={busy} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Télécharger la sauvegarde
        </button>
        <button onClick={() => input.current?.click()} disabled={busy} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-medium px-3 py-2 rounded-lg disabled:opacity-50">
          <Upload size={14} /> Restaurer une sauvegarde
        </button>
        <input ref={input} type="file" accept=".json,application/json" className="hidden" onChange={restore} />
      </div>
      {msg && <p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</p>}
    </section>
  );
}
