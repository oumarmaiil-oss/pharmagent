import React, { useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/80 bg-emerald-950/70 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/70 transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="h-3.5 w-3.5" />
        Installer l’App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-emerald-500 transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="h-3.5 w-3.5 text-emerald-400" />
          Installer sur iPhone
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-100">
                  Installer PharmAgent sur iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="space-y-2 text-xs leading-relaxed text-slate-300">
                <li>1. Appuyez sur le bouton <strong>Partager</strong> dans la barre Safari.</li>
                <li>2. Faites défiler vers le bas puis touchez <strong>Sur l’écran d’accueil</strong>.</li>
                <li>3. Confirmez pour lancer <strong>PharmAgent</strong> comme une application native.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Compris
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
