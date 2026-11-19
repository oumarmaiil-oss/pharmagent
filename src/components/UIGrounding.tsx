import { Image, Loader2, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { useRef, useState } from 'react';
import type { GroundingAnalysisResult, GroundedTargetElement, SafetyStatus } from '../types/pharmagent.ts';

interface Props {
  token: string;
}

const STATUS_META: Record<SafetyStatus, { label: string; color: string; Icon: React.ElementType }> = {
  SAFE_DRAFT: { label: 'Autorisé (brouillon)', color: 'text-emerald-400', Icon: ShieldCheck },
  FORBIDDEN_BY_GUARDRAIL: { label: 'Bloqué (guardrail)', color: 'text-red-400', Icon: ShieldAlert },
  UNKNOWN: { label: 'Non classifié', color: 'text-slate-400', Icon: ShieldOff },
};

export default function UIGrounding({ token }: Props) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GroundingAnalysisResult | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImageFile(f);
    setResult(null);
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  };

  const handleAnalyze = async () => {
    if (!imageFile) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('image', imageFile);
      const r = await fetch('/api/agent/ground-interface', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await r.json() as GroundingAnalysisResult & { error?: string };
      if (!r.ok) { setError(data.error ?? 'Erreur analyse.'); return; }
      setResult(data);
    } catch {
      setError('Erreur réseau.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white">Inspection UI Grounding</h1>
        <p className="text-slate-400 text-sm">Analysez une capture d'interface pour détecter les boutons autorisés vs bloqués par le guardrail</p>
      </div>

      {/* Guardrail notice */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex gap-3">
        <ShieldAlert size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-200/80">
          <span className="font-semibold text-amber-300">Guardrail Draft-Only actif.</span>{' '}
          L'agent ne peut créer que des brouillons. Toute action de validation, confirmation, soumission ou finalisation est classifiée{' '}
          <span className="text-red-400 font-semibold">FORBIDDEN_BY_GUARDRAIL</span> et bloquée automatiquement.
        </div>
      </div>

      {/* Upload */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <Image size={18} className="text-slate-400" />
          <span className="text-sm font-semibold text-white">Capture d'interface à analyser</span>
        </div>

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

        {imagePreview ? (
          <div className="space-y-4">
            <img src={imagePreview} alt="Interface à analyser" className="max-h-80 rounded-lg border border-slate-700 object-contain" />
            <div className="flex gap-3">
              <button onClick={() => fileRef.current?.click()} className="text-sm text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg">
                Changer l'image
              </button>
              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                {loading ? 'Analyse…' : '→ Analyser avec Gemini'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border border-dashed border-slate-700 hover:border-slate-600 rounded-xl py-10 text-sm text-slate-500 hover:text-slate-400 transition-colors"
          >
            Cliquez pour choisir une capture d'interface (PNG, JPG…)
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Résultats */}
      {result && (
        <div className="space-y-4">
          {/* Résumé */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-white mb-3">Résumé de l'analyse</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              {(['SAFE_DRAFT', 'FORBIDDEN_BY_GUARDRAIL', 'UNKNOWN'] as const).map((status) => {
                const count = result.elements.filter((e) => e.safetyStatus === status).length;
                const meta = STATUS_META[status];
                return (
                  <div key={status} className="bg-slate-800 rounded-lg p-3">
                    <div className={`text-2xl font-bold ${meta.color}`}>{count}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{meta.label}</div>
                  </div>
                );
              })}
            </div>
            {result.observations && (
              <p className="mt-3 text-xs text-slate-400 border-t border-slate-800 pt-3">{result.observations}</p>
            )}
          </div>

          {/* Éléments classifiés */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800">
              <span className="text-sm font-semibold text-white">{result.elements.length} éléments classifiés</span>
            </div>
            <div className="divide-y divide-slate-800">
              {result.elements.map((el: GroundedTargetElement, idx: number) => {
                const meta = STATUS_META[el.safetyStatus] ?? STATUS_META.UNKNOWN;
                return (
                  <div key={idx} className="px-4 py-3 flex items-start gap-3 hover:bg-slate-800/40">
                    <meta.Icon size={16} className={`${meta.color} flex-shrink-0 mt-0.5`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-white font-medium">{el.detectedLabel}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${
                          el.safetyStatus === 'SAFE_DRAFT' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
                          el.safetyStatus === 'FORBIDDEN_BY_GUARDRAIL' ? 'bg-red-500/10 border-red-500/30 text-red-300' :
                          'bg-slate-700 border-slate-600 text-slate-400'
                        }`}>
                          {meta.label}
                        </span>
                        {el.elementRole && (
                          <span className="text-xs text-slate-500 font-mono">{el.elementRole}</span>
                        )}
                      </div>
                      {el.suggestedAction && (
                        <p className="text-xs text-slate-500 mt-0.5">{el.suggestedAction}</p>
                      )}
                    </div>
                  </div>
                );
              })}
              {result.elements.length === 0 && (
                <div className="px-4 py-8 text-center text-slate-500 text-sm">Aucun élément détecté.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
