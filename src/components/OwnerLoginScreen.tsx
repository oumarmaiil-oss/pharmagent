import React, { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { LegalContactFooter } from './LegalContactFooter';
import { PWAInstallButton } from './PWAInstallButton';
import { OwnerAuthSession } from '../types/pharmagent';
import { BottomArt, PanelIllustration, SideArt } from './Illustrations';

interface OwnerLoginScreenProps {
  onOwnerAuthenticated: (session: OwnerAuthSession) => void;
  initialPortalError?: string | null;
}

export const OwnerLoginScreen: React.FC<OwnerLoginScreenProps> = ({
  onOwnerAuthenticated,
  initialPortalError,
}) => {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialPortalError || null);
  const [imgFailed, setImgFailed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/owner/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loginId: loginId.trim(),
          password,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Connexion refusée.');
      }

      const session: OwnerAuthSession = {
        token: payload.token,
        owner: payload.owner,
      };
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('pharmagent_owner_auth', JSON.stringify(session));
      }
      setPassword('');
      onOwnerAuthenticated(session);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la connexion.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative isolate min-h-screen bg-transparent text-slate-100 flex flex-col">
      <BottomArt />
        <SideArt />
      <header className="border-b border-slate-800/80 bg-slate-900/95 backdrop-blur-md px-6 h-16 flex items-center justify-between gap-6">
        <div className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0">
          <BrandLogo className="h-7 w-7 shrink-0" />
          <span>PharmAgent</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton />
          <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-emerald-400 whitespace-nowrap shrink-0">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span>Console Supervision Centralisée</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-5xl rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden grid grid-cols-1 lg:grid-cols-12 items-stretch">
          {/* Left Panel: Crisp Dark Pharmacy Supervision Visual */}
          <div className="relative lg:col-span-6 min-h-[260px] lg:min-h-[520px] bg-slate-950 overflow-hidden">
            {!imgFailed ? (
              <PanelIllustration variant="login" label="Centre de supervision pharmaceutique PharmAgent" />
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/40 p-8 text-center">
                <BrandLogo className="h-14 w-14 mb-4" />
                <p className="text-sm font-semibold text-slate-200">
                  PharmAgent — Supervision Multi-Officines
                </p>
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent p-7 pt-20">
              <p className="text-xs font-medium text-emerald-400">
                Supervision · Abonnements · Entraînement IA
              </p>
              <h2 className="mt-1.5 text-xl font-semibold text-slate-100">
                Pilotez l’ensemble du réseau officinal depuis une console unique
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-300">
                Les officines se connectent exclusivement via leur lien dédié. Cet accès principal
                est strictement réservé à l’équipe de supervision.
              </p>
            </div>
          </div>

          {/* Right Panel: Single Supervisor Login Form */}
          <form
            onSubmit={handleSubmit}
            className="lg:col-span-6 p-7 sm:p-9 flex flex-col justify-between space-y-6 bg-slate-900"
          >
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-800 bg-emerald-950 shrink-0">
                  <ShieldCheck className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-slate-100">
                    Connexion Superviseur
                  </h1>
                  <p className="text-xs text-slate-400">
                    Propriétaire &amp; Co-Superviseurs · Accès complet multi-officines
                  </p>
                </div>
              </div>

              <div>
                <label
                  htmlFor="owner-login-id"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Identifiant Superviseur (ID)
                </label>
                <input
                  id="owner-login-id"
                  type="text"
                  required
                  autoComplete="username"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="Ex: dr.oumar"
                  className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="owner-password"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Mot de passe
                </label>
                <input
                  id="owner-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-800 bg-red-950/60 p-3 text-xs text-red-300">
                  {error}
                </div>
              )}
            </div>

            <div className="space-y-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Vérification en cours...' : 'Ouvrir la Console PharmAgent'}
              </button>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Vos identifiants personnels et la gestion de votre équipe Supervision (jusqu’à 3
                accès) sont accessibles dès l’ouverture de la console.
              </p>
            </div>
          </form>
        </div>
      </main>

      <LegalContactFooter />
    </div>
  );
};
