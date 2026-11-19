import React, { useState } from 'react';
import { Award, Mail, Phone, ShieldCheck } from 'lucide-react';

export const LegalContactFooter: React.FC = () => {
  const [showLicenseDetails, setShowLicenseDetails] = useState(false);

  return (
    <footer className="mt-auto border-t border-slate-800/80 bg-slate-950/90 px-6 py-4 text-xs text-slate-400">
      <div className="mx-auto max-w-[1400px] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 text-slate-200 font-medium">
              <Award className="h-3.5 w-3.5 text-emerald-500/90" />
              Licence Commerciale Active
            </span>
            <span className="text-slate-700">·</span>
            <span>
              Dr. Oumar <span className="text-slate-500">(DU Commercial)</span> — Sénégal
            </span>
            <button
              type="button"
              onClick={() => setShowLicenseDetails((v) => !v)}
              className="text-[11px] text-slate-400 underline decoration-slate-700 underline-offset-2 hover:text-emerald-400 transition-colors"
            >
              {showLicenseDetails ? 'Masquer détails licence' : 'Termes de licence'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="tel:+221774144799"
              className="inline-flex items-center gap-1.5 text-slate-300 hover:text-emerald-300 transition-colors tabular-nums"
              title="Appeler Dr. Oumar"
            >
              <Phone className="h-3.5 w-3.5 text-emerald-500/80" />
              <span>+221 77 414 47 99</span>
            </a>

            <span className="text-slate-700">·</span>

            <span className="text-slate-400 font-mono text-[11px] hidden sm:inline">
              oumarmaiil@gmail.com
            </span>

            <a
              href="mailto:oumarmaiil@gmail.com?subject=PharmAgent%20%E2%80%94%20Contact%20%26%20Licence%20Commerciale"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-slate-200 hover:border-emerald-500/70 hover:text-emerald-300 transition-colors whitespace-nowrap shrink-0"
            >
              <Mail className="h-3.5 w-3.5 text-emerald-400" />
              Contacter par e-mail
            </a>
          </div>
        </div>

        {showLicenseDetails && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-3 text-[11px] leading-relaxed text-slate-400 flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                Licence Commerciale Propriétaire — PharmAgent Officine
              </div>
              <p>
                Droits d’exploitation commerciale et de déploiement multi-officines détenus par{' '}
                <strong className="text-slate-200">Dr. Oumar</strong> (DU Commercial, Sénégal).
                Chaque officine raccordée dispose d’un lien isolé, d’une clé d’appairage et d’un
                quota mensuel réel rattachés à son abonnement. Toute reproduction ou redistribution
                non autorisée est interdite.
              </p>
            </div>
            <div className="font-mono text-[10px] text-slate-500 shrink-0">
              LICENCE : PA-COM-SN-2026
            </div>
          </div>
        )}
      </div>
    </footer>
  );
};
