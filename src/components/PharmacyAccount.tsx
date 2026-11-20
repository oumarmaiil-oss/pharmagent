import { KeyRound, Loader2, Package, Upload, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PharmacySession } from '../App.tsx';

interface Props {
  token: string;
  session: PharmacySession;
  onTeamAccountCreated: () => void;
}

const input = 'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-emerald-500 outline-none';

export default function PharmacyAccount({ token, session, onTeamAccountCreated }: Props) {
  const isPharmacist = session.user.profile === 'pharmacien';
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [teamPw, setTeamPw] = useState('');
  const [teamErr, setTeamErr] = useState('');
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  const [catalogMsg, setCatalogMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const catalogInput = useRef<HTMLInputElement>(null);
  const phId = session.pharmacy.id;

  useEffect(() => {
    if (!isPharmacist) return;
    fetch(`/api/pharmacies/${phId}/catalog`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d: { total?: number }) => setCatalogTotal(d.total ?? 0))
      .catch(() => setCatalogTotal(null));
  }, [isPharmacist, phId, token]);

  const importCatalog = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCatalogBusy(true); setCatalogMsg(null);
    try {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const r = await post(`/api/pharmacies/${phId}/catalog/import`, { fileBase64 });
      const d = await r.json() as { added?: number; updated?: number; total?: number; error?: string };
      if (!r.ok) { setCatalogMsg({ ok: false, text: d.error ?? 'Import impossible.' }); return; }
      setCatalogTotal(d.total ?? null);
      setCatalogMsg({ ok: true, text: `${d.added} produit(s) ajouté(s), ${d.updated} mis à jour.` });
    } catch {
      setCatalogMsg({ ok: false, text: 'Fichier illisible.' });
    } finally {
      setCatalogBusy(false);
    }
  };

  const post = (url: string, body: object) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next !== pw.confirm) { setPwMsg({ ok: false, text: 'Les deux nouveaux mots de passe ne sont pas identiques.' }); return; }
    setBusy(true);
    try {
      const r = await post('/api/pharmacy/auth/change-password', { current: pw.current, next: pw.next });
      const d = await r.json() as { error?: string };
      if (!r.ok) { setPwMsg({ ok: false, text: d.error ?? 'Modification impossible.' }); return; }
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg({ ok: true, text: 'Mot de passe modifié.' });
    } catch {
      setPwMsg({ ok: false, text: 'Connexion impossible.' });
    } finally {
      setBusy(false);
    }
  };

  const resetTeam = async () => {
    if (session.teamAccount && !window.confirm("Réinitialiser le mot de passe du compte Équipe ? L'ancien ne fonctionnera plus.")) return;
    setTeamErr(''); setTeamPw(''); setBusy(true);
    try {
      const r = await post('/api/pharmacy/team-account', {});
      const d = await r.json() as { password?: string; error?: string };
      if (!r.ok || !d.password) { setTeamErr(d.error ?? 'Opération impossible.'); return; }
      setTeamPw(d.password);
      onTeamAccountCreated();
    } catch {
      setTeamErr('Connexion impossible.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white">Mon compte</h1>
        <p className="text-slate-400 text-sm">{session.pharmacy.name} · {isPharmacist ? 'Compte Pharmacien' : 'Compte Équipe'}</p>
      </div>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="text-xs text-slate-400">Code de connexion de la pharmacie</div>
        <div className="mono text-2xl font-bold text-emerald-300 tracking-widest mt-1">{session.pharmacy.code}</div>
        <p className="text-xs text-slate-500 mt-2">C'est l'identifiant de connexion de la pharmacie. Le Pharmacien et l'Équipe tapent ce même identifiant, chacun avec son mot de passe.</p>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-white mb-3 flex items-center gap-2"><KeyRound size={15} className="text-emerald-400" /> Changer mon mot de passe</h2>
        <form onSubmit={changePassword} className="space-y-3">
          <input type="password" autoComplete="current-password" placeholder="Mot de passe actuel" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required className={input} />
          <input type="password" autoComplete="new-password" placeholder="Nouveau mot de passe (6 caractères minimum)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required minLength={6} className={input} />
          <input type="password" autoComplete="new-password" placeholder="Confirmer le nouveau mot de passe" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required className={input} />
          {pwMsg && <p className={`text-xs ${pwMsg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{pwMsg.text}</p>}
          <button type="submit" disabled={busy} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg">
            {busy && <Loader2 size={14} className="animate-spin" />} Enregistrer
          </button>
        </form>
      </section>

      {isPharmacist && (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Package size={15} className="text-emerald-400" /> Catalogue produits</h2>
          <p className="text-xs text-slate-400">
            Exportez la liste des produits de votre logiciel (Excel ou CSV) et importez-la ici : les produits des bons seront reconnus automatiquement.
            Colonnes reconnues : désignation, code CIP, prix d'achat, prix de vente, stock.
          </p>
          <div className="text-sm text-slate-200">{catalogTotal === null ? '…' : `${catalogTotal.toLocaleString('fr-FR')} produit(s) dans le catalogue`}</div>
          {catalogTotal === 0 && <p className="text-xs text-amber-300">Catalogue vide : chaque produit des bons devra être choisi à la main.</p>}
          <button onClick={() => catalogInput.current?.click()} disabled={catalogBusy} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
            {catalogBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Importer le catalogue
          </button>
          <input ref={catalogInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importCatalog} />
          {catalogMsg && <p className={`text-xs ${catalogMsg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{catalogMsg.text}</p>}
        </section>
      )}

      {isPharmacist && (
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Users size={15} className="text-emerald-400" /> Compte Équipe (facultatif)</h2>
          <p className="text-xs text-slate-400">Pour vos assistants et opérateurs : ils photographient et approuvent les bons. On sait ainsi qui a lancé chaque bon. Les réglages (agent, comptes) restent réservés au compte Pharmacien.</p>
          <button onClick={resetTeam} disabled={busy} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />}
            {session.teamAccount ? 'Réinitialiser le mot de passe Équipe' : 'Créer le compte Équipe'}
          </button>
          {teamPw && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              Mot de passe du compte Équipe : <span className="mono font-bold tracking-wider">{teamPw}</span>
              <div className="text-xs text-emerald-300/80 mt-1">Notez-le maintenant : il ne sera plus affiché. Connexion de l'Équipe : identifiant {session.pharmacy.code} et ce mot de passe.</div>
            </div>
          )}
          {teamErr && <p className="text-xs text-red-300">{teamErr}</p>}
        </section>
      )}
    </div>
  );
}
