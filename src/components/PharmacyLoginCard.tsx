import React, { useState } from 'react';
import { KeyRound, Shield, UserCheck, Users } from 'lucide-react';
import { OfficineRecord, PharmacyAuthSession } from '../types/pharmagent';

interface PharmacyLoginCardProps {
  pharmacy?: OfficineRecord;
  pharmacyId: string;
  authChecking: boolean;
  onAuthenticated: (session: PharmacyAuthSession) => void;
}

export const PharmacyLoginCard: React.FC<PharmacyLoginCardProps> = ({
  pharmacy,
  pharmacyId,
  authChecking,
  onAuthenticated,
}) => {
  const [loginIdInput, setLoginIdInput] = useState('');
  const [loginPasswordInput, setLoginPasswordInput] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch(`/api/pharmacies/${pharmacyId}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginId: loginIdInput.trim(),
          password: loginPasswordInput,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Connexion refusée.');
      }

      const nextSession: PharmacyAuthSession = {
        token: payload.token,
        user: payload.user,
      };

      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          `pharmagent_auth_${pharmacyId}`,
          JSON.stringify(nextSession)
        );
        window.sessionStorage.setItem(`pharmagent_role_${pharmacyId}`, nextSession.user.role);
      }

      setLoginPasswordInput('');
      onAuthenticated(nextSession);
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : 'Erreur de connexion.');
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 grid grid-cols-1 lg:grid-cols-12 items-stretch">
        <div className="lg:col-span-5 relative min-h-[180px] bg-slate-950 overflow-hidden">
          <img
            src="/src/assets/images/banner_workspace_vision_1795079794620.jpg"
            alt={`Portail Officine ${pharmacy?.name || 'PharmAgent'}`}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover opacity-90"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent px-5 py-3.5">
            <div className="text-[11px] font-medium text-emerald-400">
              Espace dédié · Clé {pharmacy?.agentKey || 'Officine'}
            </div>
            <div className="text-sm font-semibold text-slate-100">
              {pharmacy?.name || 'Portail Officine PharmAgent'}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7 p-6 flex flex-col justify-center space-y-2">
          <h2 className="text-base font-semibold text-slate-100">
            Réception des bons de livraison &amp; contrôle avant entrée en stock
          </h2>
          <p className="text-xs leading-relaxed text-slate-300">
            Identifiez-vous avec votre compte d’officine (Titulaire, Adjoint ou Assistant).
            Chaque document numérisé s’arrête strictement au stade <strong>Brouillon</strong>{' '}
            jusqu’à votre validation humaine.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={handleLoginSubmit}
          className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-5 space-y-4"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-950 border border-emerald-800">
              <KeyRound className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Connexion Portail Officine
              </h2>
              <p className="text-xs text-slate-400">
                {pharmacy?.name || 'Officine'} — Saisissez votre identifiant (ID) et mot de passe
              </p>
            </div>
          </div>

          {authChecking && (
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
              Vérification de la session en cours...
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Identifiant (ID)
            </label>
            <input
              type="text"
              required
              autoComplete="username"
              value={loginIdInput}
              onChange={(e) => setLoginIdInput(e.target.value)}
              placeholder="Votre identifiant personnel"
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Mot de passe
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={loginPasswordInput}
              onChange={(e) => setLoginPasswordInput(e.target.value)}
              placeholder="••••••••"
              className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {loginError && (
            <div className="rounded-lg border border-red-800 bg-red-950/60 p-3 text-xs text-red-300">
              {loginError}
            </div>
          )}

          <button
            type="submit"
            disabled={loginLoading}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
          >
            {loginLoading ? 'Connexion...' : 'Se connecter à l’officine'}
          </button>

          <p className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-400">
            Les identifiants provisoires sont remis par votre Pharmacien titulaire ou le superviseur
            PharmAgent. Chaque membre peut modifier son mot de passe dès la connexion.
          </p>
        </form>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-7 space-y-4">
          <h3 className="text-base font-semibold text-slate-100">
            Séparation des rôles et continuité en officine
          </h3>
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
            <div className="rounded-lg border border-emerald-800/60 bg-slate-950 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                <Shield className="h-4 w-4 shrink-0" />
                1. Pharmacien titulaire
              </div>
              <ul className="space-y-1.5 text-[11px] text-slate-300">
                <li>• Scanner &amp; générer des brouillons</li>
                <li>• Valider en stock &amp; rejeter/supprimer</li>
                <li>• Créer et suspendre les comptes équipe</li>
                <li>• Apprendre logiciels PC / Mac &amp; .py</li>
                <li>• Exporter le registre PDF officiel</li>
              </ul>
            </div>

            <div className="rounded-lg border border-amber-800/60 bg-slate-950 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                <UserCheck className="h-4 w-4 shrink-0" />
                2. Pharmacien adjoint / Gérant
              </div>
              <ul className="space-y-1.5 text-[11px] text-slate-300">
                <li>• Autonomie quand le Titulaire est absent</li>
                <li>• Scanner, pré-corriger &amp; valider en stock</li>
                <li>• Consulter stock &amp; exporter le PDF officiel</li>
                <li className="text-amber-300/90">
                  • Rejet/suppression, comptes équipe &amp; config PC/Mac réservés au Titulaire
                </li>
              </ul>
            </div>

            <div className="rounded-lg border border-sky-800/60 bg-slate-950 p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-sky-400">
                <Users className="h-4 w-4 shrink-0" />
                3. Assistant / Préparateur
              </div>
              <ul className="space-y-1.5 text-[11px] text-slate-300">
                <li>• Photographier / importer bons &amp; factures</li>
                <li>• Remplir Excel &amp; file PC/Mac en Brouillon</li>
                <li>• Enregistrer des pré-corrections avant contrôle</li>
                <li>• Consulter le stock (lecture seule)</li>
                <li className="text-amber-300/90">
                  • Validation stock, suppression, comptes &amp; PDF officiel verrouillés
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
