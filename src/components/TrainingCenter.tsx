import React, { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Monitor,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { AgentLearnedMemory } from '../types/pharmagent';

interface TrainingCenterProps {
  memory: AgentLearnedMemory;
  onMemoryUpdated: () => void;
  onGoToPharmacistTest: () => void;
}

export const TrainingCenter: React.FC<TrainingCenterProps> = ({
  memory,
  onMemoryUpdated,
  onGoToPharmacistTest,
}) => {
  const [ruleKind, setRuleKind] = useState<'product' | 'column'>('product');
  const [rawKey, setRawKey] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [category, setCategory] = useState('Antibiotique');
  const [savingRule, setSavingRule] = useState(false);
  const [uploadingMemory, setUploadingMemory] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawKey.trim() || !targetValue.trim()) return;
    setSavingRule(true);
    setError(null);
    setFeedback(null);

    try {
      const res = await fetch('/api/training/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: ruleKind,
          key: rawKey,
          value: targetValue,
          category,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Erreur ajout règle.');
      setRawKey('');
      setTargetValue('');
      setFeedback('Règle mémorisée et enregistrée sur disque. L’agent l’appliquera dès la prochaine photo.');
      onMemoryUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteRule = async (id: string) => {
    await fetch(`/api/training/rules/${id}`, { method: 'DELETE' });
    onMemoryUpdated();
  };

  const handleUploadMemoryExcel = (file?: File) => {
    if (!file) return;
    setUploadingMemory(true);
    setError(null);
    setFeedback(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/training/upload-memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            excelBase64: reader.result,
            fileName: file.name,
          }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || 'Erreur import fichier mémoire.');
        setFeedback(
          `Mémoire mise à jour depuis ${file.name} : ${payload.importedProducts} produit(s) et ${payload.importedColumns} règle(s) de colonnes appris.`
        );
        onMemoryUpdated();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Erreur import Excel.');
      } finally {
        setUploadingMemory(false);
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* Downloadable Training Excel Kit */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-slate-100">
              Fichiers Excel d’entraînement &amp; test de bout en bout
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Téléchargez ces 3 vrais classeurs <code className="text-emerald-400">.xlsx</code>{' '}
              générés par le serveur. Vous pouvez modifier la mémoire, adapter un fichier cible à
              votre propre document photographié, puis tester dans le{' '}
              <strong className="text-slate-200">Poste Pharmacien</strong>.
            </p>
          </div>

          <button
            type="button"
            onClick={onGoToPharmacistTest}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors whitespace-nowrap shrink-0"
          >
            Tester avec une photo
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* File 1: Memory */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs font-medium text-emerald-400">
                <span>1. Ce qu’il doit mémoriser</span>
                <BookOpen className="h-4 w-4" />
              </div>
              <h3 className="mt-2 text-sm font-semibold text-slate-100">
                PharmAgent_1_Memoire_Agent.xlsx
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                Contient 2 onglets : <span className="text-slate-200">Dictionnaire_Produits</span>{' '}
                (alias fournisseur vers nom officiel) et{' '}
                <span className="text-slate-200">Regles_Colonnes_Excel</span>. Modifiez-le puis
                ré-importez-le ci-dessous pour entraîner l’agent.
              </p>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <a
                href="/api/training/download/memory"
                download="PharmAgent_1_Memoire_Agent.xlsx"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-emerald-500 hover:text-emerald-400 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger Mémoire (.xlsx)
              </a>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors">
                <Upload className="h-3.5 w-3.5 text-emerald-400" />
                {uploadingMemory ? 'Import...' : 'Ré-importer'}
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => handleUploadMemoryExcel(e.target.files?.[0])}
                />
              </label>
            </div>
          </div>

          {/* File 2: Standard Target */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs font-medium text-amber-400">
                <span>2. Là où il doit le remplir</span>
                <FileSpreadsheet className="h-4 w-4" />
              </div>
              <h3 className="mt-2 text-sm font-semibold text-slate-100">
                PharmAgent_2_Modele_Cible_Stock.xlsx
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                Modèle standard de réception officine (Date, N° Bon, Fournisseur, Désignation
                Médicament, Quantité Reçue, N° Lot, Expiration, P.U., Total, Statut Validation).
              </p>
            </div>
            <div className="mt-5">
              <a
                href="/api/training/download/target"
                download="PharmAgent_2_Modele_Cible_Stock.xlsx"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-amber-400 hover:text-amber-300 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger Modèle Cible (.xlsx)
              </a>
            </div>
          </div>

          {/* File 3: Proposed Custom Test File */}
          <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs font-medium text-emerald-400">
                <span>3. Fichier de test proposé</span>
                <Sparkles className="h-4 w-4" />
              </div>
              <h3 className="mt-2 text-sm font-semibold text-slate-100">
                PharmAgent_3_Fichier_Test_Propose.xlsx
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                Classeur personnalisé prêt pour votre test : colonnes{' '}
                <span className="font-mono text-[11px] text-emerald-300">
                  Médicament (DCI), Qté Livrée, N° Lot Fabricant, Date Péremption, Prix Achat
                  Unitaire (FCFA), Contrôle Garde-Fou
                </span>
                .
              </p>
            </div>
            <div className="mt-5">
              <a
                href="/api/training/download/custom_kit"
                download="PharmAgent_3_Fichier_Test_Propose.xlsx"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                Télécharger Fichier Test (.xlsx)
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Live Learned Memory Inspector + Teach New Rule */}
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Mémoire persistante de l’agent ({memory.productAliases.length + memory.columnRules.length}{' '}
              règles actives)
            </h2>
            <p className="text-xs text-slate-400">
              L’agent mémorise automatiquement chaque nouvelle colonne Excel découverte et chaque
              correction effectuée lors de vos validations de brouillons.
            </p>
          </div>
        </div>

        <form
          onSubmit={handleAddRule}
          className="rounded-xl border border-slate-800 bg-slate-950 p-4 grid grid-cols-1 gap-3 sm:grid-cols-12 items-end"
        >
          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Type de règle à enseigner
            </label>
            <select
              value={ruleKind}
              onChange={(e) => {
                const next = e.target.value as 'product' | 'column';
                setRuleKind(next);
                setTargetValue(next === 'column' ? 'item.designation' : '');
              }}
              className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
            >
              <option value="product">Alias Médicament (Document → Officiel)</option>
              <option value="column">Colonne Excel (En-tête → Champ JSON)</option>
            </select>
          </div>

          <div className="sm:col-span-4">
            <label className="block text-xs font-medium text-slate-400 mb-1">
              {ruleKind === 'product'
                ? 'Libellé lu sur facture/bon'
                : 'Nom exact de votre colonne Excel'}
            </label>
            <input
              type="text"
              required
              value={rawKey}
              onChange={(e) => setRawKey(e.target.value)}
              placeholder={
                ruleKind === 'product' ? 'Ex: AMOX CLAV 1G' : 'Ex: Code_Article_Stock'
              }
              className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-slate-400 mb-1">
              {ruleKind === 'product' ? 'Nom canonique en stock' : 'Champ source PharmAgent'}
            </label>
            {ruleKind === 'product' ? (
              <input
                type="text"
                required
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="Ex: Augmentin 1g B/12"
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            ) : (
              <select
                value={targetValue || 'item.designation'}
                onChange={(e) => setTargetValue(e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
              >
                <option value="item.designation">item.designation (Produit)</option>
                <option value="item.quantity">item.quantity (Quantité)</option>
                <option value="item.lotNumber">item.lotNumber (N° Lot)</option>
                <option value="item.expiryDate">item.expiryDate (Expiration)</option>
                <option value="item.unitPriceFCFA">item.unitPriceFCFA (Prix unitaire)</option>
                <option value="item.lineTotalFCFA">item.lineTotalFCFA (Total ligne)</option>
                <option value="documentNumber">documentNumber (N° Document)</option>
                <option value="supplierOrOrg">supplierOrOrg (Fournisseur / Mutuelle)</option>
                <option value="documentDate">documentDate (Date)</option>
                <option value="draftStatus">draftStatus (Statut Brouillon)</option>
              </select>
            )}
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={savingRule}
              className="h-9 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              Mémoriser
            </button>
          </div>
        </form>

        {feedback && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/60 p-3 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{feedback}</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-800 bg-red-950/60 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Product Memory Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
            <div className="border-b border-slate-800 px-4 py-3 text-xs font-semibold text-slate-200">
              Dictionnaire Produits mémorisé ({memory.productAliases.length})
            </div>
            <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
              {memory.productAliases.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-slate-300 truncate">{rule.rawLabel}</div>
                    <div className="text-emerald-400 font-medium truncate">
                      → {rule.canonicalName}
                    </div>
                    <div className="text-[11px] text-slate-500">{rule.learnedFrom}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteRule(rule.id)}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-400"
                    title="Supprimer cette règle"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Column Rules Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
            <div className="border-b border-slate-800 px-4 py-3 text-xs font-semibold text-slate-200">
              Règles de colonnes Excel apprises ({memory.columnRules.length})
            </div>
            <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
              {memory.columnRules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-200 truncate">
                      {rule.excelHeaderPattern}
                    </div>
                    <div className="font-mono text-emerald-400 truncate">
                      → {rule.targetSourceField}
                    </div>
                    <div className="text-[11px] text-slate-500">{rule.learnedFrom}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteRule(rule.id)}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-400"
                    title="Supprimer cette règle"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Permanently Learned Software UI Grounding Profiles */}
        <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Monitor className="h-4 w-4 text-emerald-400" />
              <span>
                Logiciels &amp; écrans mémorisés pour de bon ({(memory.softwareProfiles || []).length})
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              Coordonnées + script d’injection réutilisables sans ré-analyse
            </span>
          </div>
          {!memory.softwareProfiles || memory.softwareProfiles.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">
              Aucun logiciel mémorisé pour l’instant. Analysez une capture dans{' '}
              <strong className="text-slate-300">Inspecteur UI Grounding</strong> et cliquez sur «
              Mémoriser ce logiciel pour de bon ».
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-72 overflow-y-auto">
              {memory.softwareProfiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center justify-between gap-4 px-4 py-3 text-xs"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-100">{profile.softwareName}</span>
                      <span className="font-mono text-[11px] text-emerald-400">
                        {profile.detectedSoftwareType}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        · {profile.pharmacyId}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      {profile.elements.length} zone(s) UI enregistrée(s)
                      {profile.injectionScript ? ' · Script PyAutoGUI attaché' : ''}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Appris le {new Date(profile.createdAt).toLocaleString('fr-FR')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteRule(profile.id)}
                    className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-400 shrink-0"
                    title="Supprimer ce profil logiciel"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
