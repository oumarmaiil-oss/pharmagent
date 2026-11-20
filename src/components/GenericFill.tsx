// ============================================================
// PharmAgent — Remplir n'importe quel tableau à partir d'un document (registre, formulaire, tableau maison…)
// ============================================================

import { FileSpreadsheet, Loader2, Wand2 } from 'lucide-react';
import { useRef, useState } from 'react';

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
  r.readAsDataURL(file);
});

interface Report { sheet: string; columns: string[]; linesWritten: number; fieldsFilled: string[]; converted: boolean }

export default function GenericFill({ token, pharmacyId }: { token: string; pharmacyId: string }) {
  const [doc, setDoc] = useState<File | null>(null);
  const [template, setTemplate] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const tplInput = useRef<HTMLInputElement>(null);

  const run = async () => {
    if (!doc || !template) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/tools/fill-any', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pharmacyId, documentBase64: await readAsDataUrl(doc), documentName: doc.name, templateBase64: await readAsDataUrl(template) }),
      });
      const d = await r.json() as { fileBase64?: string; report?: Report; error?: string };
      if (!r.ok || !d.fileBase64 || !d.report) { setMsg({ ok: false, text: d.error ?? 'Remplissage impossible.' }); return; }
      const bytes = Uint8Array.from(atob(d.fileBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url; a.download = template.name.replace(/\.[^.]+$/, '') + '_rempli.xlsx'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const rep = d.report;
      setMsg({ ok: rep.linesWritten > 0, text: rep.linesWritten
        ? `${rep.linesWritten} ligne(s) ajoutée(s) dans « ${rep.sheet} »${rep.fieldsFilled.length ? ` · en-tête : ${rep.fieldsFilled.join(', ')}` : ''}${rep.converted ? ' · mise en forme simplifiée' : ''}. Fichier téléchargé : vérifiez-le avant de l'utiliser.`
        : `Rien à ajouter : le document ne contient pas d'informations pour les colonnes ${rep.columns.slice(0, 4).join(', ')}…` });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const pick = 'flex-1 min-w-0 flex items-center gap-2 text-left text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-2 rounded-xl truncate';
  return (
    <section className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <h2 className="text-sm font-semibold text-white flex items-center gap-2"><Wand2 size={15} className="text-emerald-400" /> Remplir un tableau à partir d'un document</h2>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        Registre mutuelle, formulaire de recueil, tableau maison… : l'IA lit le document (photo, PDF, Excel, CSV) et remplit les colonnes de votre tableau
        (Excel, LibreOffice, Numbers, CSV). Les lignes existantes et les formules sont gardées. Rien n'est saisi dans votre logiciel.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <button onClick={() => docInput.current?.click()} className={pick}><span className="text-slate-400">1.</span> {doc ? doc.name : 'Document à lire'}</button>
        <button onClick={() => tplInput.current?.click()} className={pick}><span className="text-slate-400">2.</span> {template ? template.name : 'Tableau à remplir'}</button>
        <input ref={docInput} type="file" accept="image/*,application/pdf,.pdf,.xlsx,.xls,.ods,.csv,.numbers" className="hidden" onChange={(e) => { setDoc(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        <input ref={tplInput} type="file" accept=".xlsx,.xls,.xlsm,.ods,.csv,.numbers" className="hidden" onChange={(e) => { setTemplate(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      </div>
      <button onClick={() => void run()} disabled={!doc || !template || busy}
        className="w-full flex items-center justify-center gap-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white py-2.5 rounded-xl">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />} Remplir le tableau
      </button>
      {msg && <div className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-amber-300'}`}>{msg.text}</div>}
    </section>
  );
}
