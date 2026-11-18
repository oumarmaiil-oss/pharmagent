import React, { useEffect, useState } from 'react';
import { Check, Copy, Download, FileCode2 } from 'lucide-react';

interface FastApiSourceFile {
  path: string;
  language: string;
  content: string;
}

export const FastApiCodeView: React.FC = () => {
  const [files, setFiles] = useState<FastApiSourceFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('backend-fastapi/app/main.py');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/fastapi-sources')
      .then((r) => r.json())
      .then((data) => {
        setFiles(data.files || []);
        if (data.files?.length > 0) {
          const mainFile = data.files.find((f: FastApiSourceFile) => f.path.endsWith('main.py'));
          setSelectedPath(mainFile ? mainFile.path : data.files[0].path);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const activeFile = files.find((f) => f.path === selectedPath);

  const handleCopy = async () => {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadFile = () => {
    if (!activeFile) return;
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activeFile.path.split('/').pop() || 'pharmagent.py';
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="h-96 rounded-xl border border-slate-800 bg-slate-900 animate-pulse" />
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-base font-semibold text-slate-100">
          Architecture Backend FastAPI &amp; Agent Local Python
        </h2>
        <p className="mt-1 text-sm text-slate-400 leading-relaxed">
          Code source Python complet prêt pour déploiement serveur (FastAPI + Gemini Vision + Pydantic)
          et poste officine (PyAutoGUI + OpenPyXL +{' '}
          <code className="rounded bg-slate-950 border border-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-200">
            DraftOnlyGuardrail
          </code>
          ).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="mb-3 px-2 text-xs font-semibold text-slate-400">
            Arborescence FastAPI
          </div>
          <div className="space-y-1">
            {files.map((file) => {
              const isSelected = file.path === selectedPath;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-mono transition-colors ${
                    isSelected
                      ? 'bg-emerald-950/70 font-semibold text-emerald-300 border border-emerald-800/70'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <FileCode2 className="h-4 w-4 shrink-0" />
                  <span className="truncate">{file.path.replace('backend-fastapi/', '')}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950 text-slate-100 lg:col-span-3 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
            <span className="font-mono text-xs text-slate-300">{activeFile?.path}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copié' : 'Copier'}
              </button>
              <button
                type="button"
                onClick={handleDownloadFile}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger
              </button>
            </div>
          </div>
          <pre className="overflow-x-auto p-5 text-xs font-mono leading-relaxed text-slate-200 max-h-[620px]">
            <code>{activeFile?.content}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
