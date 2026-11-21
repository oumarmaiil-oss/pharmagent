// ============================================================
// PharmAgent — Fiche d'une officine (superviseur) : informations, accès, abonnement, agent, zone sensible.
// Toute action sensible redemande le mot de passe du superviseur.
// ============================================================

import { AlertTriangle, Copy, KeyRound, Loader2, Monitor, Save, Settings2, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Pharmacy, TargetSoftwareType } from '../types/pharmagent.ts';

export const SOFTWARE_OPTIONS: TargetSoftwareType[] = ['ERP Officine Intégré', 'Excel / Tableur', 'Dossier Patient'];
const PLANS: Array<{ value: Pharmacy['subscription']; label: string; quota: number }> = [
  { value: 'trial', label: 'Essai', quota: 50 }, { value: 'standard', label: 'Standard', quota: 200 },
  { value: 'premium', label: 'Premium', quota: 500 }, { value: 'suspended', label: 'Suspendu', quota: 0 },
];

interface Props {
  ph: Pharmacy;
  token: string;
  onChanged: () => void;
  onCredentials: (c: { name: string; code: string; password: string; account: 'pharmacien' | 'equipe' }) => void;
}

interface Confirm { title: string; text: string; danger?: boolean; typeName?: boolean; run: (password: string, typed: string) => Promise<string | null> }

const input = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-emerald-500 outline-none';
const btn = 'flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border disabled:opacity-40';

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-3">
      <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide flex items-center gap-2">{icon}{title}</h3>
      {children}
    </section>
  );
}

export default function PharmacyAdmin({ ph, token, onChanged, onCredentials }: Props) {
  const [info, setInfo] = useState({ name: ph.name, city: ph.city, region: ph.region, pharmacist: ph.pharmacist, targetSoftware: ph.targetSoftware });
  const [plan, setPlan] = useState({ subscription: ph.subscription, quota: String(ph.monthlyQuota) });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const online = !!ph.agent && Date.now() - Date.parse(ph.agent.lastSeen) < 70_000;

  const send = async (url: string, method: string, body: unknown) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return { ok: r.ok, data: await r.json().catch(() => ({})) as Record<string, string> };
  };
  const save = async (url: string, body: unknown, done: string) => {
    setBusy(true); setMsg(null);
    const r = await send(url, 'PATCH', body);
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? done : r.data.error ?? 'Enregistrement impossible.' });
    if (r.ok) onChanged();
  };
  const resetPw = (account: 'pharmacien' | 'equipe') => setConfirm({
    title: `Nouveau mot de passe ${account === 'equipe' ? 'Équipe' : 'Pharmacien'}`,
    text: `L'ancien mot de passe ${account === 'equipe' ? 'Équipe' : 'Pharmacien'} de « ${ph.name} » ne fonctionnera plus et les personnes connectées avec seront déconnectées.`,
    run: async (password) => {
      const r = await send(`/api/pharmacies/${ph.id}/reset-password`, 'POST', { password, account });
      if (!r.ok) return r.data.error ?? 'Réinitialisation impossible.';
      onCredentials({ name: ph.name, code: r.data.code, password: r.data.password, account });
      return null;
    },
  });
  const revoke = () => setConfirm({
    title: "Déconnecter l'ordinateur", text: `L'agent installé chez « ${ph.name} » ne pourra plus saisir. Il faudra le relier à nouveau avec un code (onglet Agent local).`,
    run: async (password) => {
      const r = await send(`/api/pharmacies/${ph.id}/agent/revoke`, 'POST', { password });
      if (!r.ok) return r.data.error ?? 'Action impossible.';
      setMsg({ ok: true, text: 'Ordinateur déconnecté.' }); onChanged(); return null;
    },
  });
  const remove = () => setConfirm({
    title: "Supprimer l'officine", danger: true, typeName: true,
    text: `Suppression définitive de « ${ph.name} » : comptes, bons, catalogue, ventes et réglages de l'agent. Le journal est conservé. Pensez à télécharger une sauvegarde avant.`,
    run: async (password, typed) => {
      const r = await send(`/api/pharmacies/${ph.id}/delete`, 'POST', { password, confirmName: typed });
      if (!r.ok) return r.data.error ?? 'Suppression impossible.';
      onChanged(); return null;
    },
  });

  return (
    <div className="border-t border-slate-800 p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
      <Section icon={<Settings2 size={13} />} title="Informations">
        <div className="grid grid-cols-2 gap-2">
          {([['name', 'Nom'], ['pharmacist', 'Pharmacien titulaire'], ['city', 'Ville'], ['region', 'Région']] as const).map(([k, label]) => (
            <label key={k} className="text-[11px] text-slate-400">{label}
              <input className={`${input} mt-1`} value={info[k]} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} />
            </label>
          ))}
          <label className="col-span-2 text-[11px] text-slate-400">Logiciel de la pharmacie
            <select className={`${input} mt-1`} value={info.targetSoftware} onChange={(e) => setInfo({ ...info, targetSoftware: e.target.value as TargetSoftwareType })}>
              {SOFTWARE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <button disabled={busy || !info.name.trim()} onClick={() => void save(`/api/pharmacies/${ph.id}`, info, 'Informations enregistrées.')}
          className={`${btn} bg-emerald-600 hover:bg-emerald-500 border-emerald-600 text-white`}><Save size={13} /> Enregistrer</button>
      </Section>

      <Section icon={<KeyRound size={13} />} title="Accès">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-slate-400 text-xs">Identifiant de connexion</span>
          <span className="flex items-center gap-2">
            <span className="font-mono font-bold tracking-widest text-emerald-300">{ph.code}</span>
            <button onClick={() => void navigator.clipboard?.writeText(ph.code ?? '')} title="Copier" className="text-slate-400 hover:text-white"><Copy size={13} /></button>
          </span>
        </div>
        <p className="text-[11px] text-slate-500">Le Pharmacien et l'Équipe se connectent avec cet identifiant, chacun avec son mot de passe. Les mots de passe ne sont jamais affichés : on en crée un nouveau.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => resetPw('pharmacien')} className={`${btn} bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200`}>Nouveau mot de passe Pharmacien</button>
          <button onClick={() => resetPw('equipe')} className={`${btn} bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200`}>Nouveau mot de passe Équipe</button>
        </div>
      </Section>

      <Section icon={<Settings2 size={13} />} title="Abonnement">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-slate-400">Formule
            <select className={`${input} mt-1`} value={plan.subscription}
              onChange={(e) => { const p = PLANS.find((x) => x.value === e.target.value)!; setPlan({ subscription: p.value, quota: String(p.quota) }); }}>
              {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-400">Bons par mois
            <input className={`${input} mt-1`} inputMode="numeric" value={plan.quota} onChange={(e) => setPlan({ ...plan, quota: e.target.value })} />
          </label>
        </div>
        <div className="text-[11px] text-slate-500">Ce mois-ci : {ph.usedThisMonth} / {ph.monthlyQuota} bons. « Suspendu » bloque les nouvelles analyses, sans rien supprimer.</div>
        <button disabled={busy} onClick={() => void save(`/api/pharmacies/${ph.id}/subscription`, { plan: plan.subscription, quota: Number(plan.quota) }, 'Abonnement enregistré.')}
          className={`${btn} bg-emerald-600 hover:bg-emerald-500 border-emerald-600 text-white`}><Save size={13} /> Enregistrer</button>
      </Section>

      <Section icon={<Monitor size={13} />} title="Agent (ordinateur de la pharmacie)">
        <div className="text-sm">
          {ph.agent
            ? <span className={online ? 'text-emerald-300' : 'text-slate-400'}>{online ? 'En ligne' : 'Hors ligne'} · {ph.agent.hostname ?? 'ordinateur'} · vu le {new Date(ph.agent.lastSeen).toLocaleString('fr-FR')}</span>
            : <span className="text-slate-400">Aucun ordinateur relié. Installation : onglet Agent local.</span>}
        </div>
        <button onClick={revoke} className={`${btn} bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200`}><Monitor size={13} /> Déconnecter l'ordinateur</button>
      </Section>

      <section className="lg:col-span-2 rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex flex-wrap items-center gap-3">
        <ShieldAlert size={16} className="text-red-400" />
        <div className="flex-1 min-w-0 text-xs text-red-200">Zone sensible : suppression définitive de l'officine et de ses données.</div>
        <button onClick={remove} className={`${btn} bg-red-600/80 hover:bg-red-600 border-red-600 text-white`}><Trash2 size={13} /> Supprimer l'officine</button>
      </section>

      {msg && <div className={`lg:col-span-2 text-xs ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</div>}
      {confirm && <ConfirmDialog c={confirm} name={ph.name} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function ConfirmDialog({ c, name, onClose }: { c: Confirm; name: string; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = password && (!c.typeName || typed.trim().toLowerCase() === name.trim().toLowerCase());
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const err = await c.run(password, typed);
    setBusy(false);
    if (err) setError(err); else onClose();
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <form onSubmit={(e) => void submit(e)} className={`w-full max-w-md rounded-2xl border ${c.danger ? 'border-red-500/40' : 'border-slate-700'} bg-slate-900 p-5 space-y-3 shadow-2xl`}>
        <div className="flex items-center gap-2 text-base font-semibold text-white">{c.danger && <AlertTriangle size={18} className="text-red-400" />}{c.title}</div>
        <p className="text-xs text-slate-300 leading-relaxed">{c.text}</p>
        {c.typeName && (
          <label className="block text-[11px] text-slate-400">Retapez le nom de l'officine : <b className="text-slate-200">{name}</b>
            <input className={`${input} mt-1`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
        )}
        <label className="block text-[11px] text-slate-400">Votre mot de passe superviseur
          <input type="password" className={`${input} mt-1`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </label>
        {error && <div className="text-xs text-red-300">{error}</div>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm py-2 rounded-lg">Annuler</button>
          <button type="submit" disabled={!ready || busy} className={`flex-1 flex items-center justify-center gap-2 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-40 ${c.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
            {busy && <Loader2 size={14} className="animate-spin" />} Confirmer
          </button>
        </div>
      </form>
    </div>
  );
}
