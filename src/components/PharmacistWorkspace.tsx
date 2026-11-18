import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Laptop,
  PackageCheck,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  DocumentCategory,
  DraftRecord,
  ExtractedLineItem,
  OfficineRecord,
  QueuedDesktopTask,
  StockItemRecord,
  TargetExecutionMode,
} from '../types/pharmagent';

interface PharmacistWorkspaceProps {
  pharmacies: OfficineRecord[];
  selectedPharmacyId: string;
  onChangePharmacyId: (id: string) => void;
  drafts: DraftRecord[];
  stock: StockItemRecord[];
  taskQueue: QueuedDesktopTask[];
  onDataUpdated: () => void;
  lockedPharmacy?: boolean;
}

export const PharmacistWorkspace: React.FC<PharmacistWorkspaceProps> = ({
  pharmacies,
  selectedPharmacyId,
  onChangePharmacyId,
  drafts,
  stock,
  taskQueue,
  onDataUpdated,
  lockedPharmacy = false,
}) => {
  const selectedPharmacy = useMemo(
    () => pharmacies.find((p) => p.id === selectedPharmacyId) || pharmacies[0],
    [pharmacies, selectedPharmacyId]
  );

  // Camera & Photo State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoMime, setPhotoMime] = useState<string>('image/jpeg');
  const [sampleFallbackPath, setSampleFallbackPath] = useState<string | null>(null);

  // Task & Target Mode State
  const [documentHint, setDocumentHint] = useState<DocumentCategory>('bon_livraison');
  const [taskPrompt, setTaskPrompt] = useState<string>(
    'Extrais tous les médicaments, quantités et numéros de lot, puis prépare le brouillon d’entrée en stock.'
  );
  const [targetMode, setTargetMode] = useState<TargetExecutionMode>('excel_upload');
  const [uploadedExcelBase64, setUploadedExcelBase64] = useState<string | null>(null);
  const [uploadedExcelName, setUploadedExcelName] = useState<string | null>(null);

  // Execution State
  const [runningTask, setRunningTask] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [lastCreatedDraft, setLastCreatedDraft] = useState<DraftRecord | null>(null);

  // Pharmacist Review & Stock View
  const [workspaceSubTab, setWorkspaceSubTab] = useState<'drafts' | 'stock' | 'desktop_queue'>('drafts');
  const [editingItemsByDraft, setEditingItemsByDraft] = useState<Record<string, ExtractedLineItem[]>>({});
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const pharmacyDrafts = useMemo(
    () => drafts.filter((d) => d.pharmacyId === selectedPharmacyId),
    [drafts, selectedPharmacyId]
  );

  const pharmacyStock = useMemo(
    () => stock.filter((s) => s.pharmacyId === selectedPharmacyId),
    [stock, selectedPharmacyId]
  );

  const pharmacyQueue = useMemo(
    () => taskQueue.filter((t) => t.pharmacyId === selectedPharmacyId),
    [taskQueue, selectedPharmacyId]
  );

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Votre navigateur ne supporte pas la capture vidéo directe. Utilisez le bouton « Importer / Photo mobile ».'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 60);
    } catch {
      setCameraError(
        'Accès caméra refusé ou aucun capteur détecté. Vous pouvez importer directement une photo depuis votre appareil.'
      );
    }
  };

  const capturePhotoFromCamera = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    setPhotoPreview(dataUrl);
    setPhotoMime('image/jpeg');
    setSampleFallbackPath(null);
    stopCamera();
  };

  const handlePhotoUpload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(reader.result as string);
      setPhotoMime(file.type || 'image/jpeg');
      setSampleFallbackPath(null);
      stopCamera();
    };
    reader.readAsDataURL(file);
  };

  const handleExcelUpload = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedExcelBase64(reader.result as string);
      setUploadedExcelName(file.name);
      setTargetMode('excel_upload');
    };
    reader.readAsDataURL(file);
  };

  const handleLaunchMission = async () => {
    if (!photoPreview && !sampleFallbackPath) {
      setTaskError('Prenez une photo avec la caméra ou importez un document avant de lancer l’agent.');
      return;
    }
    if (targetMode === 'excel_upload' && !uploadedExcelBase64) {
      setTaskError('Importez votre fichier Excel (.xlsx) cible ou choisissez un autre mode.');
      return;
    }

    setRunningTask(true);
    setTaskError(null);
    setActionFeedback(null);

    try {
      const res = await fetch('/api/agent/run-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pharmacyId: selectedPharmacyId,
          taskPrompt,
          documentHint,
          imageBase64: photoPreview || undefined,
          sampleAssetPath: photoPreview ? undefined : sampleFallbackPath,
          mimeType: photoMime,
          targetMode,
          uploadedExcelBase64: uploadedExcelBase64 || undefined,
          uploadedExcelName: uploadedExcelName || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || 'Échec de l’exécution de l’agent.');
      }

      setLastCreatedDraft(payload.draft);
      setWorkspaceSubTab(targetMode === 'local_desktop' ? 'desktop_queue' : 'drafts');
      const learnedMsg =
        payload.learnedColumnsCount > 0
          ? ` (+${payload.learnedColumnsCount} nouvelle(s) colonne(s) mémorisée(s))`
          : '';
      setActionFeedback(
        `Brouillon ${payload.draft.extracted.documentNumber} créé par l’agent (${payload.tokensConsumed.toLocaleString('fr-FR')} tokens)${learnedMsg}. En attente de votre validation.`
      );
      onDataUpdated();
    } catch (err: unknown) {
      setTaskError(err instanceof Error ? err.message : 'Erreur lors du lancement de l’agent.');
    } finally {
      setRunningTask(false);
    }
  };

  const updateDraftItemField = (
    draft: DraftRecord,
    idx: number,
    field: keyof ExtractedLineItem,
    value: string | number
  ) => {
    const current = editingItemsByDraft[draft.id] || draft.extracted.lineItems;
    const next = current.map((item, i) => (i === idx ? { ...item, [field]: value } : item));
    setEditingItemsByDraft((prev) => ({ ...prev, [draft.id]: next }));
  };

  const handleApproveDraft = async (draft: DraftRecord) => {
    setApprovingId(draft.id);
    setActionFeedback(null);
    try {
      const itemsToSave = editingItemsByDraft[draft.id] || draft.extracted.lineItems;
      const res = await fetch(`/api/drafts/${draft.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineItems: itemsToSave,
          pharmacistName: selectedPharmacy?.pharmacist,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Erreur validation.');
      setActionFeedback(
        `Document ${draft.extracted.documentNumber} validé par ${payload.draft.validatedBy}. Le stock de l’officine et la mémoire des corrections ont été mis à jour.`
      );
      setWorkspaceSubTab('stock');
      onDataUpdated();
    } catch (err: unknown) {
      setTaskError(err instanceof Error ? err.message : 'Erreur lors de la validation.');
    } finally {
      setApprovingId(null);
    }
  };

  const handleRejectDraft = async (draftId: string) => {
    await fetch(`/api/drafts/${draftId}/reject`, { method: 'POST' });
    onDataUpdated();
  };

  return (
    <div className="space-y-6">
      {/* Pharmacy Selector Header */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label htmlFor="pharmacist-office-select" className="block text-xs font-medium text-slate-400">
                Officine connectée
              </label>
              {lockedPharmacy && selectedPharmacy ? (
                <div className="mt-1 flex h-9 items-center rounded-lg border border-emerald-800/60 bg-slate-950 px-3 text-sm font-semibold text-slate-100">
                  {selectedPharmacy.name} — {selectedPharmacy.city}
                </div>
              ) : (
                <select
                  id="pharmacist-office-select"
                  value={selectedPharmacyId}
                  onChange={(e) => onChangePharmacyId(e.target.value)}
                  className="mt-1 h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  {pharmacies.map((ph) => (
                    <option key={ph.id} value={ph.id}>
                      {ph.name} — {ph.city}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedPharmacy && (
              <div className="border-l border-slate-800 pl-4 text-xs">
                <div className="font-medium text-slate-200">{selectedPharmacy.pharmacist}</div>
                <div className="mt-0.5 text-slate-400">
                  Clé Agent PC :{' '}
                  <span className="font-mono font-semibold text-emerald-400">
                    {selectedPharmacy.agentKey}
                  </span>{' '}
                  · {selectedPharmacy.targetSoftware}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            L’agent prépare le Brouillon · Validation finale réservée au pharmacien
          </div>
        </div>
      </section>

      {/* Main Pharmacist Cockpit: Camera + Mission + Target */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Real Camera & Photo Input */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-5 flex flex-col">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-100">
              1. Document photographié
            </h2>
            <p className="text-xs text-slate-400">
              Utilisez votre caméra ou importez une photo de bon, facture ou mutuelle
            </p>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {!cameraActive ? (
              <button
                type="button"
                onClick={startCamera}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-white transition-colors"
              >
                <Camera className="h-4 w-4" />
                Ouvrir la caméra
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <Square className="h-3.5 w-3.5 text-red-500" />
                Fermer caméra
              </button>
            )}

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors">
              <Upload className="h-4 w-4" />
              Importer / Photo mobile
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handlePhotoUpload(e.target.files?.[0])}
              />
            </label>
          </div>

          {cameraError && (
            <div className="mb-3 rounded-lg border border-amber-800/70 bg-amber-950/50 p-3 text-xs text-amber-300">
              {cameraError}
            </div>
          )}

          <div className="relative flex-1 min-h-[280px] flex items-center justify-center rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
            {cameraActive ? (
              <div className="relative w-full h-full flex flex-col items-center justify-center bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full max-h-[340px] object-contain"
                />
                <button
                  type="button"
                  onClick={capturePhotoFromCamera}
                  className="mt-3 mb-3 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  <Camera className="h-4 w-4" />
                  Capturer le document
                </button>
              </div>
            ) : photoPreview || sampleFallbackPath ? (
              <img
                src={photoPreview || sampleFallbackPath || ''}
                alt="Document officine à traiter"
                referrerPolicy="no-referrer"
                className="max-h-[360px] w-auto object-contain"
              />
            ) : (
              <div className="p-6 text-center">
                <Camera className="mx-auto h-9 w-9 text-slate-600" />
                <p className="mt-2 text-xs font-medium text-slate-300">
                  Aucune photo chargée pour l’instant
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Ouvrez la caméra ou utilisez une démo documentaire ci-dessous :
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoPreview(null);
                      setSampleFallbackPath('/src/assets/images/sample_bon_livraison_1795017387838.jpg');
                      setDocumentHint('bon_livraison');
                    }}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:border-emerald-500 hover:text-emerald-400"
                  >
                    Démo Bon Laborex
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPhotoPreview(null);
                      setSampleFallbackPath('/src/assets/images/sample_facture_mutuelle_1795017386332.jpg');
                      setDocumentHint('mutuelle');
                    }}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-300 hover:border-emerald-500 hover:text-emerald-400"
                  >
                    Démo Facture IPM
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Mission Prompt & Real Execution Target */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 lg:col-span-7 flex flex-col justify-between space-y-5">
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                2. Donner une tâche à l’agent
              </h2>
              <p className="text-xs text-slate-400">
                L’agent applique automatiquement sa mémoire apprise pour extraire et remplir la cible
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Type de document
                </label>
                <select
                  value={documentHint}
                  onChange={(e) => setDocumentHint(e.target.value as DocumentCategory)}
                  className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-xs font-medium text-slate-100 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="bon_livraison">Bon de livraison grossiste</option>
                  <option value="facture">Facture fournisseur</option>
                  <option value="mutuelle">Bordereau / Facture mutuelle</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-400 mb-1">
                  Instruction pour l’agent
                </label>
                <textarea
                  rows={2}
                  value={taskPrompt}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                  placeholder="Ex: Extrais les articles, vérifie les dates de péremption et remplis mon fichier Excel..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                'Remplis mon tableau Excel avec les colonnes exactes et arrête-toi au Brouillon.',
                'Prépare le brouillon d’entrée en stock et signale les lots qui expirent avant 2028.',
                'Prépare le bordereau mutuelle en brouillon sans valider la facturation.',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTaskPrompt(preset)}
                  className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-400 hover:border-emerald-600 hover:text-emerald-300 transition-colors"
                >
                  {preset}
                </button>
              ))}
            </div>

            {/* Real Execution Target Selector */}
            <div>
              <div className="text-xs font-medium text-slate-300 mb-2">
                3. Où l’agent doit-il exécuter cette tâche ?
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setTargetMode('excel_upload')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    targetMode === 'excel_upload'
                      ? 'border-emerald-500 bg-emerald-950/40'
                      : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                    Votre fichier Excel (.xlsx)
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Lit vos vraies colonnes, remplit les lignes en Brouillon et apprend le format.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setTargetMode('erp_live')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    targetMode === 'erp_live'
                      ? 'border-emerald-500 bg-emerald-950/40'
                      : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                    <PackageCheck className="h-4 w-4 text-emerald-400" />
                    ERP Officine Intégré
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Crée un brouillon persistant dans l’officine, prêt pour votre validation.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setTargetMode('local_desktop')}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    targetMode === 'local_desktop'
                      ? 'border-emerald-500 bg-emerald-950/40'
                      : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
                    <Laptop className="h-4 w-4 text-emerald-400" />
                    Poste PC Officine (Logiciel Local)
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Envoie la tâche au worker Python local sur votre ordinateur de caisse.
                  </p>
                </button>
              </div>

              {targetMode === 'excel_upload' && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
                  <div className="text-xs text-slate-300">
                    {uploadedExcelName ? (
                      <span>
                        Classeur chargé :{' '}
                        <strong className="font-mono text-emerald-400">{uploadedExcelName}</strong>
                      </span>
                    ) : (
                      <span>Importez votre classeur Excel (.xlsx) adapté à votre document :</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href="/api/training/download/custom_kit"
                      download="PharmAgent_3_Fichier_Test_Propose.xlsx"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:border-emerald-500 hover:text-emerald-400"
                    >
                      <Download className="h-3 w-3" />
                      Modèle proposé
                    </a>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-950/60 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-900/60">
                      <Upload className="h-3.5 w-3.5" />
                      {uploadedExcelName ? 'Changer .xlsx' : 'Choisir un fichier .xlsx'}
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => handleExcelUpload(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                </div>
              )}

              {targetMode === 'local_desktop' && selectedPharmacy && (
                <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-slate-300">
                  <div className="text-slate-500">
                    # Sur le PC de l’officine ({selectedPharmacy.targetSoftware}) :
                  </div>
                  <div className="mt-1 text-emerald-400">
                    python pharmagent_local_agent.py --server {window.location.origin} --key{' '}
                    {selectedPharmacy.agentKey}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 pt-2">
            {taskError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/60 p-3 text-xs text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <span>{taskError}</span>
              </div>
            )}

            {actionFeedback && (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-xs text-emerald-300">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                  <span>{actionFeedback}</span>
                </div>
                {lastCreatedDraft?.draftArtifactUrl && (
                  <a
                    href={lastCreatedDraft.draftArtifactUrl}
                    download={lastCreatedDraft.draftFileName}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-500 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Télécharger .xlsx rempli
                  </a>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={handleLaunchMission}
              disabled={runningTask}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors"
            >
              <Send className="h-4 w-4" />
              {runningTask
                ? 'L’agent analyse la photo et remplit le Brouillon...'
                : 'Exécuter la tâche (Arrêt strict au Brouillon)'}
            </button>
          </div>
        </div>
      </section>

      {/* Live Preview of Last Filled Excel Rows */}
      {lastCreatedDraft?.excelPreviewHeaders && lastCreatedDraft?.excelPreviewRows && (
        <section className="rounded-xl border border-emerald-800/70 bg-slate-900 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                Aperçu direct des lignes injectées dans votre fichier Excel ({lastCreatedDraft.draftFileName})
              </h3>
              <p className="text-xs text-slate-400">
                Colonnes associées automatiquement par l’agent et mémorisées pour les prochains
                envois
              </p>
            </div>
            {lastCreatedDraft.draftArtifactUrl && (
              <a
                href={lastCreatedDraft.draftArtifactUrl}
                download={lastCreatedDraft.draftFileName}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger le fichier Excel rempli
              </a>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950 text-emerald-400">
                  {lastCreatedDraft.excelPreviewHeaders.map((header) => (
                    <th key={header} className="px-4 py-2.5 font-mono font-medium whitespace-nowrap">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {lastCreatedDraft.excelPreviewRows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/40">
                    {lastCreatedDraft.excelPreviewHeaders!.map((header) => (
                      <td key={header} className="px-4 py-2.5 text-slate-200 whitespace-nowrap font-mono">
                        {String(row[header] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Bottom: Real Persisted Drafts (Human Validation) + Live Stock + Desktop Queue */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
            <button
              type="button"
              onClick={() => setWorkspaceSubTab('drafts')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                workspaceSubTab === 'drafts'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Brouillons à valider ({pharmacyDrafts.filter((d) => d.status === 'BROUILLON').length})
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceSubTab('stock')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                workspaceSubTab === 'stock'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Stock réel officine ({pharmacyStock.length})
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceSubTab('desktop_queue')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                workspaceSubTab === 'desktop_queue'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              File Agent PC ({pharmacyQueue.length})
            </button>
          </div>

          <div className="text-xs text-slate-400">
            Toute correction de nom avant validation est mémorisée par l’agent
          </div>
        </div>

        <div className="p-6">
          {workspaceSubTab === 'drafts' && (
            <div className="space-y-6">
              {pharmacyDrafts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500">
                  Aucun brouillon enregistré pour cette officine. Prenez une photo et lancez l’agent
                  ci-dessus.
                </div>
              ) : (
                pharmacyDrafts.map((draft) => {
                  const items = editingItemsByDraft[draft.id] || draft.extracted.lineItems;
                  const isPending = draft.status === 'BROUILLON';
                  return (
                    <div
                      key={draft.id}
                      className="rounded-lg border border-slate-800 bg-slate-950/60 overflow-hidden"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-950 px-5 py-3.5">
                        <div>
                          <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-100">
                            <span className="font-mono text-emerald-400">
                              {draft.extracted.documentNumber}
                            </span>
                            <span className="text-slate-600">·</span>
                            <span>{draft.extracted.supplierOrOrg}</span>
                            <span className="text-slate-600">·</span>
                            <span
                              className={`text-xs font-medium ${
                                draft.status === 'VALIDE_PAR_PHARMACIEN'
                                  ? 'text-emerald-400'
                                  : draft.status === 'REJETE'
                                  ? 'text-red-400'
                                  : 'text-amber-400'
                              }`}
                            >
                              {draft.status === 'VALIDE_PAR_PHARMACIEN'
                                ? `Validé par ${draft.validatedBy}`
                                : draft.status === 'REJETE'
                                ? 'Rejeté'
                                : 'BROUILLON — En attente validation pharmacien'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-xs text-slate-400">
                            Mission : {draft.taskPrompt}
                          </p>
                          {draft.extracted.agentObservations && (
                            <p className="mt-1 text-xs font-medium text-slate-300">
                              Observation agent : {draft.extracted.agentObservations}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {draft.draftArtifactUrl && (
                            <a
                              href={draft.draftArtifactUrl}
                              download={draft.draftFileName}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
                            >
                              <Download className="h-3.5 w-3.5 text-emerald-400" />
                              Excel Brouillon
                            </a>
                          )}

                          {isPending && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleRejectDraft(draft.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Rejeter
                              </button>
                              <button
                                type="button"
                                onClick={() => handleApproveDraft(draft)}
                                disabled={approvingId === draft.id}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                              >
                                <Check className="h-3.5 w-3.5" />
                                {approvingId === draft.id
                                  ? 'Validation...'
                                  : 'Valider définitivement en stock (Humain)'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400">
                              <th className="px-4 py-2 font-medium">Désignation</th>
                              <th className="px-4 py-2 font-medium text-right">Quantité</th>
                              <th className="px-4 py-2 font-medium">N° Lot</th>
                              <th className="px-4 py-2 font-medium">Expiration</th>
                              <th className="px-4 py-2 font-medium text-right">P.U. (FCFA)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/80">
                            {items.map((item, idx) => (
                              <tr key={idx} className="hover:bg-slate-900/40">
                                <td className="px-4 py-2 font-medium text-slate-100">
                                  {isPending ? (
                                    <input
                                      type="text"
                                      value={item.designation}
                                      onChange={(e) =>
                                        updateDraftItemField(draft, idx, 'designation', e.target.value)
                                      }
                                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                                    />
                                  ) : (
                                    item.designation
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right font-mono tabular-nums">
                                  {isPending ? (
                                    <input
                                      type="number"
                                      value={item.quantity}
                                      onChange={(e) =>
                                        updateDraftItemField(
                                          draft,
                                          idx,
                                          'quantity',
                                          Number(e.target.value)
                                        )
                                      }
                                      className="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                                    />
                                  ) : (
                                    item.quantity
                                  )}
                                </td>
                                <td className="px-4 py-2 font-mono text-slate-300">
                                  {isPending ? (
                                    <input
                                      type="text"
                                      value={item.lotNumber}
                                      onChange={(e) =>
                                        updateDraftItemField(draft, idx, 'lotNumber', e.target.value)
                                      }
                                      className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                                    />
                                  ) : (
                                    item.lotNumber
                                  )}
                                </td>
                                <td className="px-4 py-2 font-mono text-slate-300">
                                  {item.expiryDate || 'N/A'}
                                </td>
                                <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-200">
                                  {Number(item.unitPriceFCFA).toLocaleString('fr-FR')}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {workspaceSubTab === 'stock' && (
            <div className="overflow-x-auto">
              {pharmacyStock.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  Aucun article en stock pour cette officine. Validez un brouillon pour alimenter le
                  stock.
                </p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950 text-slate-400">
                      <th className="px-4 py-2.5 font-medium">Désignation</th>
                      <th className="px-4 py-2.5 font-medium text-right">Stock physique</th>
                      <th className="px-4 py-2.5 font-medium">N° Lot</th>
                      <th className="px-4 py-2.5 font-medium">Expiration</th>
                      <th className="px-4 py-2.5 font-medium text-right">P.U. (FCFA)</th>
                      <th className="px-4 py-2.5 font-medium">Dernier document</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80">
                    {pharmacyStock.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-medium text-slate-100">
                          {item.designation}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-semibold text-emerald-400 tabular-nums">
                          {item.quantity}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-300">{item.lotNumber}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-300">{item.expiryDate}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-200">
                          {item.unitPriceFCFA.toLocaleString('fr-FR')}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-400">
                          {item.sourceDocument}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {workspaceSubTab === 'desktop_queue' && (
            <div className="space-y-3">
              {pharmacyQueue.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">
                  Aucune tâche en attente pour l’agent desktop local.
                </p>
              ) : (
                pharmacyQueue.map((task) => (
                  <div
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs"
                  >
                    <div>
                      <div className="font-mono font-semibold text-slate-100">
                        {task.id} · {task.extracted.documentNumber} ({task.extracted.lineItems.length}{' '}
                        lignes)
                      </div>
                      <div className="mt-1 text-slate-400">{task.taskPrompt}</div>
                    </div>
                    <span className="font-mono font-medium text-amber-400">{task.status}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
