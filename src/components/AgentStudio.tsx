import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  CheckCircle2,
  Code2,
  Crosshair,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  Play,
  ScanEye,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  DocumentCategory,
  ExecutionRunResult,
  ExtractedDocumentData,
  GroundingAnalysisResult,
  OfficineRecord,
} from '../types/pharmagent';

interface AgentStudioProps {
  pharmacies: OfficineRecord[];
  selectedPharmacyId: string;
  onChangePharmacyId: (id: string) => void;
  onRunCompleted: () => void;
}

const SAMPLE_DOCS = [
  {
    id: 'bl-laborex',
    label: 'Bon de Livraison — Laborex Dakar',
    category: 'bon_livraison' as DocumentCategory,
    path: '/src/assets/images/sample_bon_livraison_1795017387838.jpg',
  },
  {
    id: 'fac-mutuelle',
    label: 'Facture Mutuelle IPM — Tambacounda',
    category: 'mutuelle' as DocumentCategory,
    path: '/src/assets/images/sample_facture_mutuelle_1795017386332.jpg',
  },
];

const SAMPLE_TARGETS = [
  {
    id: 'erp-officine',
    label: 'ERP Officine Intégré (Saisie Réception)',
    softwareType: 'erp_form' as const,
    path: '/src/assets/images/target_erp_screenshot_1795017387811.jpg',
  },
  {
    id: 'excel-stock',
    label: 'Excel — Suivi_Stock_Officine_2026.xlsx',
    softwareType: 'excel_grid' as const,
    path: '/src/assets/images/target_excel_screenshot_1795017389210.jpg',
  },
];

export const AgentStudio: React.FC<AgentStudioProps> = ({
  pharmacies,
  selectedPharmacyId,
  onChangePharmacyId,
  onRunCompleted,
}) => {
  const [selectedDocPreset, setSelectedDocPreset] = useState(SAMPLE_DOCS[0]);
  const [customDocPreview, setCustomDocPreview] = useState<string | null>(null);
  const [customDocBase64, setCustomDocBase64] = useState<string | null>(null);
  const [customDocMime, setCustomDocMime] = useState<string>('image/jpeg');
  const [docViewMode, setDocViewMode] = useState<'table' | 'json'>('table');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedDocumentData | null>(null);
  const [docImageError, setDocImageError] = useState(false);

  const [selectedTargetPreset, setSelectedTargetPreset] = useState(SAMPLE_TARGETS[0]);
  const [customTargetPreview, setCustomTargetPreview] = useState<string | null>(null);
  const [customTargetBase64, setCustomTargetBase64] = useState<string | null>(null);
  const [customTargetMime, setCustomTargetMime] = useState<string>('image/jpeg');
  const [groundingLoading, setGroundingLoading] = useState(false);
  const [groundingError, setGroundingError] = useState<string | null>(null);
  const [groundingResult, setGroundingResult] = useState<GroundingAnalysisResult | null>(null);
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  const [targetImageError, setTargetImageError] = useState(false);

  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionRunResult | null>(null);

  const [profileNameInput, setProfileNameInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savedProfileMsg, setSavedProfileMsg] = useState<string | null>(null);
  const [saveProfileError, setSaveProfileError] = useState<string | null>(null);

  const selectedPharmacy = useMemo(
    () => pharmacies.find((p) => p.id === selectedPharmacyId) || pharmacies[0],
    [pharmacies, selectedPharmacyId]
  );

  const activeDocSrc = customDocPreview || selectedDocPreset.path;
  const activeTargetSrc = customTargetPreview || selectedTargetPreset.path;

  const handleFileUpload = (file: File | undefined, kind: 'doc' | 'target') => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (kind === 'doc') {
        setCustomDocPreview(dataUrl);
        setCustomDocBase64(dataUrl);
        setCustomDocMime(file.type || 'image/jpeg');
        setDocImageError(false);
        setExtractedData(null);
        setGroundingResult(null);
        setExecutionResult(null);
      } else {
        setCustomTargetPreview(dataUrl);
        setCustomTargetBase64(dataUrl);
        setCustomTargetMime(file.type || 'image/png');
        setTargetImageError(false);
        setGroundingResult(null);
        setExecutionResult(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleExtractDocument = async () => {
    setExtracting(true);
    setExtractError(null);
    setGroundingResult(null);
    setExecutionResult(null);

    try {
      const response = await fetch('/api/agent/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pharmacyId: selectedPharmacyId,
          documentHint: selectedDocPreset.category,
          imageBase64: customDocBase64 || undefined,
          sampleAssetPath: customDocBase64 ? undefined : selectedDocPreset.path,
          mimeType: customDocMime,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Échec de l’analyse Gemini Vision.');
      }
      setExtractedData(payload.extracted);
      onRunCompleted();
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setExtracting(false);
    }
  };

  const handleRunGrounding = async () => {
    if (!extractedData) return;
    setGroundingLoading(true);
    setGroundingError(null);
    setExecutionResult(null);

    try {
      const response = await fetch('/api/agent/ground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pharmacyId: selectedPharmacyId,
          extractedData,
          screenshotBase64: customTargetBase64 || undefined,
          sampleAssetPath: customTargetBase64 ? undefined : selectedTargetPreset.path,
          mimeType: customTargetMime,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Échec du UI Grounding.');
      }
      setGroundingResult(payload.grounding);
      onRunCompleted();
    } catch (err: unknown) {
      setGroundingError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setGroundingLoading(false);
    }
  };

  const handleExecuteDraft = async (attemptFinalValidation: boolean) => {
    if (!extractedData || !groundingResult) return;
    setExecuting(true);
    setExecError(null);

    try {
      const response = await fetch('/api/agent/execute-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pharmacyId: selectedPharmacyId,
          extractedData,
          elements: groundingResult.elements,
          attemptFinalValidation,
          targetSoftwareType: groundingResult.detectedSoftwareType,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Erreur lors de l’exécution.');
      }
      setExecutionResult(payload);
      onRunCompleted();
    } catch (err: unknown) {
      setExecError(err instanceof Error ? err.message : 'Erreur d’exécution.');
    } finally {
      setExecuting(false);
    }
  };

  const handleSaveSoftwareProfile = async () => {
    if (!groundingResult) return;
    const defaultName =
      profileNameInput.trim() ||
      selectedPharmacy?.targetSoftware ||
      selectedTargetPreset.label;
    setSavingProfile(true);
    setSaveProfileError(null);
    setSavedProfileMsg(null);

    try {
      const response = await fetch('/api/training/software-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          softwareName: defaultName,
          pharmacyId: selectedPharmacyId,
          detectedSoftwareType: groundingResult.detectedSoftwareType,
          elements: groundingResult.elements,
          injectionScript: executionResult?.pythonScriptPreview || '',
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Échec de mémorisation du logiciel.');
      }
      setSavedProfileMsg(
        `Logiciel « ${payload.profile.softwareName} » mémorisé pour de bon (${payload.profile.elements.length} zones + garde-fou). L’agent local l’utilisera automatiquement.`
      );
      setProfileNameInput('');
      onRunCompleted();
    } catch (err: unknown) {
      setSaveProfileError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Studio Context Bar */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label
                htmlFor="pharmacy-select"
                className="block text-xs font-medium text-slate-400"
              >
                Officine inspectée
              </label>
              <select
                id="pharmacy-select"
                value={selectedPharmacyId}
                onChange={(e) => onChangePharmacyId(e.target.value)}
                className="mt-1 h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-medium text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                {pharmacies.map((ph) => (
                  <option key={ph.id} value={ph.id}>
                    {ph.name} — {ph.city} ({ph.targetSoftware})
                  </option>
                ))}
              </select>
            </div>

            {selectedPharmacy && (
              <div className="border-l border-slate-800 pl-4 text-xs text-slate-400">
                <div className="font-medium text-slate-200">{selectedPharmacy.pharmacist}</div>
                <div className="mt-0.5">
                  Cible : <span className="font-mono text-emerald-400">{selectedPharmacy.targetSoftware}</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className={`font-medium ${extractedData ? 'text-emerald-400' : 'text-slate-100'}`}>
              01. Extraction Vision
            </span>
            <span className="text-slate-600">/</span>
            <span
              className={`font-medium ${
                groundingResult ? 'text-emerald-400' : extractedData ? 'text-slate-100' : 'text-slate-500'
              }`}
            >
              02. UI Grounding
            </span>
            <span className="text-slate-600">/</span>
            <span
              className={`font-medium ${
                executionResult ? 'text-emerald-400' : groundingResult ? 'text-slate-100' : 'text-slate-500'
              }`}
            >
              03. Saisie Brouillon
            </span>
          </div>
        </div>
      </section>

      {/* STAGE 1: Gemini Vision Document Extraction */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              01. Extraction Documentaire par Gemini Vision
            </h2>
            <p className="text-xs text-slate-400">
              Sélectionnez une démo ou importez une photo de bon de livraison, facture ou mutuelle
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {SAMPLE_DOCS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setSelectedDocPreset(preset);
                  setCustomDocPreview(null);
                  setCustomDocBase64(null);
                  setDocImageError(false);
                  setExtractedData(null);
                  setGroundingResult(null);
                  setExecutionResult(null);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  !customDocPreview && selectedDocPreset.id === preset.id
                    ? 'bg-slate-100 text-slate-950'
                    : 'border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {preset.label}
              </button>
            ))}

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0">
              <Upload className="h-3.5 w-3.5" />
              Importer un document
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files?.[0], 'doc')}
              />
            </label>

            <button
              type="button"
              onClick={handleExtractDocument}
              disabled={extracting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              <ScanEye className="h-3.5 w-3.5" />
              {extracting ? 'Analyse Gemini Vision...' : 'Extraire en JSON'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
          <div className="p-6 lg:col-span-5 bg-slate-950/60 flex flex-col items-center justify-center">
            {docImageError ? (
              <div className="flex h-72 w-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900 p-6 text-center">
                <FileText className="h-8 w-8 text-slate-500" />
                <p className="mt-2 text-xs font-medium text-slate-300">
                  {selectedDocPreset.label}
                </p>
                <p className="mt-1 text-xs text-slate-500">Aperçu image indisponible</p>
              </div>
            ) : (
              <img
                src={activeDocSrc}
                alt={selectedDocPreset.label}
                referrerPolicy="no-referrer"
                onError={() => setDocImageError(true)}
                className="max-h-[420px] w-auto rounded-lg border border-slate-800 object-contain"
              />
            )}
          </div>

          <div className="p-6 lg:col-span-7 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-medium text-slate-300">
                Données structurées extraites
                {extractedData?.tokensConsumed ? (
                  <span className="ml-2 font-mono text-emerald-400 tabular-nums">
                    ({extractedData.tokensConsumed.toLocaleString('fr-FR')} tokens)
                  </span>
                ) : null}
              </div>

              {extractedData && (
                <div className="flex items-center gap-1 rounded-lg bg-slate-950 p-1 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setDocViewMode('table')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      docViewMode === 'table'
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400'
                    }`}
                  >
                    Vue Tableau
                  </button>
                  <button
                    type="button"
                    onClick={() => setDocViewMode('json')}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      docViewMode === 'json'
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400'
                    }`}
                  >
                    JSON Brut
                  </button>
                </div>
              )}
            </div>

            {extractError && (
              <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-800 bg-red-950/60 p-3.5 text-xs text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <div>{extractError}</div>
              </div>
            )}

            {extracting ? (
              <div className="space-y-3 py-6">
                <div className="h-10 rounded-lg bg-slate-800 animate-pulse" />
                <div className="h-36 rounded-lg bg-slate-800 animate-pulse" />
              </div>
            ) : !extractedData ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 p-8 text-center">
                <ScanEye className="h-8 w-8 text-slate-600" />
                <p className="mt-3 text-sm font-medium text-slate-300">
                  En attente d’extraction Gemini Vision
                </p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  Cliquez sur « Extraire en JSON » pour lire automatiquement les désignations,
                  quantités, numéros de lot et prix unitaires.
                </p>
              </div>
            ) : docViewMode === 'json' ? (
              <pre className="max-h-[360px] overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-emerald-300">
                {JSON.stringify(extractedData, null, 2)}
              </pre>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3.5 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-slate-400">N° Document</div>
                    <div className="mt-0.5 font-mono font-semibold text-slate-100">
                      {extractedData.documentNumber}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Fournisseur / Org.</div>
                    <div className="mt-0.5 font-medium text-slate-100 truncate">
                      {extractedData.supplierOrOrg}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Date</div>
                    <div className="mt-0.5 font-mono text-slate-200">
                      {extractedData.documentDate}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Total HT</div>
                    <div className="mt-0.5 font-mono font-semibold text-emerald-400 tabular-nums">
                      {extractedData.totalAmountFCFA.toLocaleString('fr-FR')} {extractedData.currency}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950 text-slate-400">
                        <th className="px-3 py-2 font-medium">Désignation</th>
                        <th className="px-3 py-2 font-medium text-right">Qté</th>
                        <th className="px-3 py-2 font-medium">Lot</th>
                        <th className="px-3 py-2 font-medium">Exp.</th>
                        <th className="px-3 py-2 font-medium text-right">P.U. (FCFA)</th>
                        <th className="px-3 py-2 font-medium text-right">Confiance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {extractedData.lineItems.map((item, i) => (
                        <tr key={i} className="hover:bg-slate-800/40">
                          <td className="px-3 py-2 font-medium text-slate-100">
                            {item.designation}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-100">
                            {item.quantity}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-300">
                            {item.lotNumber || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-300">
                            {item.expiryDate || '—'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-100">
                            {item.unitPriceFCFA.toLocaleString('fr-FR')}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-400">
                            {Math.round((item.confidence || 0.95) * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* STAGE 2: Adaptive UI Grounding */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              02. Reconnaissance d’Interface (UI Grounding) &amp; Mapping Sémantique
            </h2>
            <p className="text-xs text-slate-400">
              Inspecte visuellement une capture du logiciel cible, localise les champs et verrouille
              les boutons de validation définitive
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {SAMPLE_TARGETS.map((target) => (
              <button
                key={target.id}
                type="button"
                onClick={() => {
                  setSelectedTargetPreset(target);
                  setCustomTargetPreview(null);
                  setCustomTargetBase64(null);
                  setTargetImageError(false);
                  setGroundingResult(null);
                  setExecutionResult(null);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  !customTargetPreview && selectedTargetPreset.id === target.id
                    ? 'bg-slate-100 text-slate-950'
                    : 'border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {target.label}
              </button>
            ))}

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0">
              <Upload className="h-3.5 w-3.5" />
              Capture cible
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files?.[0], 'target')}
              />
            </label>

            <button
              type="button"
              onClick={handleRunGrounding}
              disabled={!extractedData || groundingLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Crosshair className="h-3.5 w-3.5" />
              {groundingLoading ? 'UI Grounding en cours...' : 'Analyser l’écran cible'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
          <div className="p-6 lg:col-span-7 bg-slate-950/60">
            <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-950">
              {targetImageError ? (
                <div className="flex h-80 items-center justify-center text-xs text-slate-500">
                  Capture cible indisponible
                </div>
              ) : (
                <img
                  src={activeTargetSrc}
                  alt={selectedTargetPreset.label}
                  referrerPolicy="no-referrer"
                  onError={() => setTargetImageError(true)}
                  className="block w-full h-auto select-none"
                />
              )}

              {groundingResult && (
                <div className="pointer-events-none absolute inset-0">
                  {groundingResult.elements.map((el) => {
                    const [ymin, xmin, ymax, xmax] = el.box_2d;
                    const top = `${ymin / 10}%`;
                    const left = `${xmin / 10}%`;
                    const width = `${Math.max(2, (xmax - xmin) / 10)}%`;
                    const height = `${Math.max(2, (ymax - ymin) / 10)}%`;

                    const isForbidden = el.safetyStatus === 'FORBIDDEN_BY_GUARDRAIL';
                    const isDraftBtn = el.safetyStatus === 'AUTHORIZED_DRAFT_SAVE';
                    const isHovered = hoveredElementId === el.id;

                    const borderClass = isForbidden
                      ? 'border-red-500 bg-red-500/20'
                      : isDraftBtn
                      ? 'border-amber-400 bg-amber-400/20'
                      : 'border-emerald-500 bg-emerald-500/15';

                    return (
                      <div
                        key={el.id}
                        style={{ top, left, width, height }}
                        className={`absolute border-2 transition-all ${borderClass} ${
                          isHovered ? 'ring-2 ring-white z-20' : 'z-10'
                        }`}
                      >
                        <span
                          className={`absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white shadow-sm ${
                            isForbidden
                              ? 'bg-red-600'
                              : isDraftBtn
                              ? 'bg-amber-600'
                              : 'bg-emerald-700'
                          }`}
                        >
                          {isForbidden ? `BLOQUÉ: ${el.detectedLabel}` : el.detectedLabel}
                        </span>

                        {executionResult &&
                          !isForbidden &&
                          !isDraftBtn &&
                          el.semanticMapping?.sampleValueToInsert && (
                            <div className="flex h-full w-full items-center px-1.5">
                              <span className="truncate rounded bg-slate-950/95 px-1.5 py-0.5 font-mono text-[11px] font-medium text-emerald-300 border border-emerald-700 shadow-sm">
                                {el.semanticMapping.sampleValueToInsert}
                              </span>
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {groundingResult && (
              <div className="mt-3 flex flex-wrap items-center gap-5 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border-2 border-emerald-500 bg-emerald-500/20" />
                  Champ / Colonne mappé
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border-2 border-amber-400 bg-amber-400/20" />
                  Bouton Brouillon autorisé
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-3 rounded-sm border-2 border-red-500 bg-red-500/20" />
                  Validation finale bloquée par Garde-Fou
                </span>
              </div>
            )}
          </div>

          <div className="p-6 lg:col-span-5 flex flex-col">
            <h3 className="text-xs font-semibold text-slate-300 mb-3">
              Table de correspondance sémantique &amp; coordonnées (0–1000)
            </h3>

            {groundingError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-800 bg-red-950/60 p-3 text-xs text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400 mt-0.5" />
                <span>{groundingError}</span>
              </div>
            )}

            {groundingLoading ? (
              <div className="space-y-2.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div key={n} className="h-12 rounded-lg bg-slate-800 animate-pulse" />
                ))}
              </div>
            ) : !groundingResult ? (
              <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-slate-800 p-8 text-center">
                <Crosshair className="h-8 w-8 text-slate-600" />
                <p className="mt-3 text-sm font-medium text-slate-300">
                  {extractedData
                    ? 'Prêt pour le UI Grounding'
                    : 'Complétez d’abord l’étape 01'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Gemini Vision détectera les zones cliquables et isolera tout bouton de validation
                  définitive.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {groundingResult.elements.map((el) => {
                  const isForbidden = el.safetyStatus === 'FORBIDDEN_BY_GUARDRAIL';
                  const isDraft = el.safetyStatus === 'AUTHORIZED_DRAFT_SAVE';
                  return (
                    <div
                      key={el.id}
                      onMouseEnter={() => setHoveredElementId(el.id)}
                      onMouseLeave={() => setHoveredElementId(null)}
                      className={`rounded-lg border p-3 text-xs transition-colors ${
                        isForbidden
                          ? 'border-red-800/80 bg-red-950/40'
                          : isDraft
                          ? 'border-amber-800/80 bg-amber-950/30'
                          : 'border-slate-800 bg-slate-950 hover:border-emerald-500'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-100">{el.detectedLabel}</span>
                        <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                          ({el.centerPoint.x}, {el.centerPoint.y})
                        </span>
                      </div>

                      {isForbidden ? (
                        <div className="mt-1.5 flex items-center gap-1.5 font-medium text-red-400">
                          <Lock className="h-3.5 w-3.5 shrink-0" />
                          <span>Interdit par Garde-Fou (Validation Finale)</span>
                        </div>
                      ) : isDraft ? (
                        <div className="mt-1.5 flex items-center gap-1.5 font-medium text-amber-400">
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                          <span>Point d’arrêt obligatoire : Sauvegarde Brouillon</span>
                        </div>
                      ) : el.semanticMapping ? (
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-slate-400">
                          <span className="font-mono text-[11px] text-slate-500 truncate">
                            {el.semanticMapping.sourceJsonPath}
                          </span>
                          <span className="font-medium text-emerald-400 truncate max-w-[180px]">
                            → {el.semanticMapping.sampleValueToInsert}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {groundingResult && (
              <div className="mt-4 rounded-lg border border-emerald-800/60 bg-emerald-950/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-emerald-300">
                    Apprendre ce logiciel pour de bon
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {groundingResult.detectedSoftwareType}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={profileNameInput}
                    onChange={(e) => setProfileNameInput(e.target.value)}
                    placeholder={
                      selectedPharmacy?.targetSoftware || 'Nom du logiciel (ex: Logiciel Comptoir Local)'
                    }
                    className="h-8 flex-1 min-w-[180px] rounded-lg border border-slate-700 bg-slate-950 px-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveSoftwareProfile}
                    disabled={savingProfile}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                  >
                    <BookmarkCheck className="h-3.5 w-3.5" />
                    {savingProfile ? 'Enregistrement...' : 'Mémoriser ce logiciel pour de bon'}
                  </button>
                </div>
                {savedProfileMsg && (
                  <p className="text-[11px] text-emerald-300">{savedProfileMsg}</p>
                )}
                {saveProfileError && (
                  <p className="text-[11px] text-red-400">{saveProfileError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* STAGE 3: Controlled Execution & Absolute Guardrail */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              03. Exécution Automatisée &amp; Garde-Fou de Sécurité Absolu
            </h2>
            <p className="text-xs text-slate-400">
              Remplissage contrôlé avec arrêt formel au stade « Brouillon » et génération du fichier
              Excel de contrôle
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleExecuteDraft(false)}
              disabled={!groundingResult || executing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" />
              {executing ? 'Exécution...' : 'Exécuter la saisie (Arrêt au Brouillon)'}
            </button>

            <button
              type="button"
              onClick={() => handleExecuteDraft(true)}
              disabled={!groundingResult || executing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-800 bg-red-950/60 px-4 py-2 text-xs font-medium text-red-300 hover:bg-red-900/60 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Simuler tentative Validation Finale
            </button>
          </div>
        </div>

        <div className="p-6">
          {execError && (
            <div className="mb-4 rounded-lg border border-red-800 bg-red-950/60 p-3.5 text-xs text-red-300">
              {execError}
            </div>
          )}

          {!executionResult ? (
            <div className="rounded-lg border border-dashed border-slate-800 p-8 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-slate-600" />
              <p className="mt-3 text-sm font-medium text-slate-300">
                Prêt pour l’exécution sécurisée en mode Brouillon
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Exécutez le cycle nominal (arrêt au Brouillon) ou testez le blocage automatique en
                simulant une demande de validation définitive.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-7">
                <div
                  className={`flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4 ${
                    executionResult.guardrailTriggered
                      ? 'border-red-800 bg-red-950/40'
                      : 'border-emerald-800 bg-emerald-950/40'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {executionResult.guardrailTriggered ? (
                      <ShieldAlert className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
                    )}
                    <div>
                      <div
                        className={`text-sm font-semibold ${
                          executionResult.guardrailTriggered ? 'text-red-300' : 'text-emerald-300'
                        }`}
                      >
                        {executionResult.guardrailTriggered
                          ? 'Validation Finale Interceptée & Bloquée par le Garde-Fou'
                          : 'Brouillon Enregistré — Arrêt Obligatoire Respecté'}
                      </div>
                      <p
                        className={`mt-0.5 text-xs ${
                          executionResult.guardrailTriggered ? 'text-red-300/80' : 'text-emerald-300/80'
                        }`}
                      >
                        {executionResult.guardrailReport}
                      </p>
                    </div>
                  </div>

                  {executionResult.draftArtifactUrl && (
                    <a
                      href={executionResult.draftArtifactUrl}
                      download={executionResult.draftFileName}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
                      Télécharger Brouillon (.xlsx)
                      <Download className="h-3.5 w-3.5 text-slate-400" />
                    </a>
                  )}
                </div>

                <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950">
                  {executionResult.steps.map((step) => (
                    <div
                      key={step.stepIndex}
                      className="flex items-start justify-between gap-4 px-4 py-3 text-xs"
                    >
                      <div className="flex items-start gap-3">
                        <span className="font-mono text-slate-500 tabular-nums">
                          {String(step.stepIndex).padStart(2, '0')}.
                        </span>
                        <div>
                          <div className="font-medium text-slate-100">{step.targetLabel}</div>
                          <div className="mt-0.5 text-slate-400">{step.message}</div>
                        </div>
                      </div>
                      <span
                        className={`font-mono text-[11px] font-medium whitespace-nowrap shrink-0 ${
                          step.status === 'BLOCKED_BY_GUARDRAIL'
                            ? 'text-red-400'
                            : step.status === 'STOPPED_AT_DRAFT'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {step.status === 'BLOCKED_BY_GUARDRAIL'
                          ? 'BLOQUÉ'
                          : step.status === 'STOPPED_AT_DRAFT'
                          ? 'ARRÊT BROUILLON'
                          : 'EXÉCUTÉ'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-5 flex flex-col rounded-lg border border-slate-800 bg-slate-950 overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-300">
                    <Code2 className="h-3.5 w-3.5 text-emerald-400" />
                    Script PyAutoGUI généré
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {executionResult.runId}
                  </span>
                </div>
                <pre className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-200 max-h-[340px]">
                  <code>{executionResult.pythonScriptPreview}</code>
                </pre>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
