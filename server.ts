import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as XLSX from 'xlsx';
import {
  extractDocumentWithGemini,
  groundTargetInterfaceWithGemini,
  mapToRealExcelColumnsWithGemini,
} from './src/server/geminiAgent.ts';
import { guardrail, SafetyViolationError } from './src/server/guardrail.ts';
import { store } from './src/server/store.ts';
import type {
  DocumentCategory,
  DraftRecord,
  ExecutionRunResult,
  ExecutionStepLog,
  ExtractedDocumentData,
  ExtractedLineItem,
  GroundedTargetElement,
  TargetExecutionMode,
  TargetSoftwareType,
} from './src/types/pharmagent.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '30mb' }));

function resolveImagePayload(
  base64Input?: string,
  sampleAssetPath?: string,
  fallbackMime = 'image/jpeg'
): { base64: string; mimeType: string } {
  if (base64Input) {
    const match = base64Input.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { mimeType: match[1], base64: match[2] };
    }
    return { mimeType: fallbackMime, base64: base64Input };
  }

  if (sampleAssetPath) {
    const safeRelative = sampleAssetPath.replace(/^\/+/, '');
    if (!safeRelative.startsWith('src/assets/images/')) {
      throw new Error('Chemin d’image exemple non autorisé.');
    }
    const absolutePath = path.resolve(__dirname, safeRelative);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Image exemple introuvable : ${safeRelative}`);
    }
    const buffer = fs.readFileSync(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    return { base64: buffer.toString('base64'), mimeType };
  }

  throw new Error('Aucune image fournie (ni photo prise/importée, ni exemple sélectionné).');
}

function resolveSourceFieldValue(
  extracted: ExtractedDocumentData,
  item: ExtractedLineItem,
  sourceField: string
): string | number {
  switch (sourceField) {
    case 'documentNumber':
      return extracted.documentNumber;
    case 'supplierOrOrg':
      return extracted.supplierOrOrg;
    case 'documentDate':
      return extracted.documentDate;
    case 'item.designation':
      return item.designation;
    case 'item.quantity':
      return item.quantity;
    case 'item.lotNumber':
      return item.lotNumber || 'N/A';
    case 'item.expiryDate':
      return item.expiryDate || 'N/A';
    case 'item.unitPriceFCFA':
      return item.unitPriceFCFA;
    case 'item.lineTotalFCFA':
      return item.quantity * item.unitPriceFCFA;
    case 'draftStatus':
      return 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN';
    default:
      return '';
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'PharmAgent' });
});

app.get('/api/dashboard', (_req, res) => {
  res.json(store.getDashboard());
});

app.post('/api/pharmacies', (req, res) => {
  try {
    const { name, city, region, pharmacist, targetSoftware } = req.body as {
      name: string;
      city: string;
      region?: string;
      pharmacist: string;
      targetSoftware: TargetSoftwareType;
    };

    if (!name?.trim() || !city?.trim() || !pharmacist?.trim()) {
      res.status(400).json({ error: 'Nom de l’officine, ville et titulaire sont obligatoires.' });
      return;
    }

    const created = store.createPharmacy({
      name,
      city,
      region: region || city,
      pharmacist,
      targetSoftware: targetSoftware || 'ERP Officine Intégré',
    });

    res.status(201).json({ pharmacy: created });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur création officine.';
    res.status(500).json({ error: message });
  }
});

/**
 * Génération des 3 fichiers Excel d'entraînement et de test réel :
 * 1. memory     -> PharmAgent_Memoire_Mapping.xlsx (Ce que l'agent mémorise)
 * 2. target     -> PharmAgent_Modele_Cible_Stock.xlsx (Là où il doit le remplir)
 * 3. custom_kit -> PharmAgent_Proposition_Test_Officine.xlsx (Fichier spécial proposé pour tester)
 */
app.get('/api/training/download/:templateType', (req, res) => {
  const { templateType } = req.params;
  const memory = store.getMemory();
  const wb = XLSX.utils.book_new();
  let fileName = 'PharmAgent.xlsx';

  if (templateType === 'memory') {
    const productRows = memory.productAliases.map((p) => ({
      'Libellé Brut Document (Alias)': p.rawLabel,
      'Désignation Officiale Officine': p.canonicalName,
      Catégorie: p.category,
      Origine: p.learnedFrom,
    }));
    const columnRows = memory.columnRules.map((c) => ({
      'En-tête Colonne Excel': c.excelHeaderPattern,
      'Champ JSON Source': c.targetSourceField,
      Origine: c.learnedFrom,
    }));

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(productRows), 'Dictionnaire_Produits');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(columnRows), 'Regles_Colonnes_Excel');
    fileName = 'PharmAgent_1_Memoire_Agent.xlsx';
  } else if (templateType === 'target') {
    const targetRows = [
      {
        'Date Réception': '17/11/2026',
        'N° Bon / Facture': 'BL-EXEMPLE-001',
        Fournisseur: 'COPHASE DAKAR',
        'Désignation Médicament': 'Amoxicilline 500mg Gélule B/24',
        'Quantité Reçue': 30,
        'N° Lot': 'AMX2601',
        'Date Expiration': '05/2028',
        'Prix Unitaire (FCFA)': 1850,
        'Total Ligne (FCFA)': 55500,
        'Statut Validation': 'VALIDE (EXEMPLE)',
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(targetRows), 'Reception_Stock');
    fileName = 'PharmAgent_2_Modele_Cible_Stock.xlsx';
  } else if (templateType === 'custom_kit') {
    const customRows = [
      {
        'Référence Bon': 'BL-REF-DEMO',
        'Laboratoire / Fournisseur': 'LABOREX SENEGAL',
        'Date Document': '15/11/2026',
        'Médicament (DCI)': 'Paracétamol Doliprane 1000mg B/8',
        'Qté Livrée': 50,
        'N° Lot Fabricant': 'DOL9001',
        'Date Péremption': '12/2027',
        'Prix Achat Unitaire (FCFA)': 1200,
        'Montant Ligne (FCFA)': 60000,
        'Contrôle Garde-Fou': 'EXEMPLE INITIAL',
      },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customRows), 'Suivi_Entrees_Test');
    fileName = 'PharmAgent_3_Fichier_Test_Propose.xlsx';
  } else {
    res.status(404).json({ error: 'Type de fichier Excel inconnu.' });
    return;
  }

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buffer);
});

app.post('/api/training/upload-memory', (req, res) => {
  try {
    const { excelBase64, fileName = 'Memoire_Importee.xlsx' } = req.body as {
      excelBase64: string;
      fileName?: string;
    };
    if (!excelBase64) {
      res.status(400).json({ error: 'Fichier Excel manquant.' });
      return;
    }

    const cleanB64 = excelBase64.replace(/^data:[^;]+;base64,/, '');
    const wb = XLSX.read(Buffer.from(cleanB64, 'base64'), { type: 'buffer' });
    let importedProducts = 0;
    let importedColumns = 0;

    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
        defval: '',
      });
      for (const row of rows) {
        const rawLabel = String(
          row['Libellé Brut Document (Alias)'] || row['Alias'] || row['rawLabel'] || ''
        ).trim();
        const canonicalName = String(
          row['Désignation Officiale Officine'] || row['Nom Officiel'] || row['canonicalName'] || ''
        ).trim();
        const category = String(row['Catégorie'] || row['category'] || 'Médicament').trim();

        if (rawLabel && canonicalName) {
          store.addProductAliasRule({
            rawLabel,
            canonicalName,
            category,
            learnedFrom: `Import Excel (${fileName})`,
          });
          importedProducts += 1;
        }

        const headerPat = String(
          row['En-tête Colonne Excel'] || row['Colonne'] || row['excelHeaderPattern'] || ''
        ).trim();
        const sourceField = String(
          row['Champ JSON Source'] || row['Champ'] || row['targetSourceField'] || ''
        ).trim();
        if (headerPat && sourceField) {
          store.addColumnMappingRule({
            excelHeaderPattern: headerPat,
            targetSourceField: sourceField,
            learnedFrom: `Import Excel (${fileName})`,
          });
          importedColumns += 1;
        }
      }
    }

    res.json({
      importedProducts,
      importedColumns,
      learnedMemory: store.getMemory(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lecture fichier mémoire Excel.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/training/rules', (req, res) => {
  const { kind, key, value, category } = req.body as {
    kind: 'product' | 'column';
    key: string;
    value: string;
    category?: string;
  };
  if (!key?.trim() || !value?.trim()) {
    res.status(400).json({ error: 'Les deux champs sont requis.' });
    return;
  }
  if (kind === 'product') {
    store.addProductAliasRule({
      rawLabel: key.trim(),
      canonicalName: value.trim(),
      category: category?.trim() || 'Officine',
      learnedFrom: 'Ajout manuel Pharmacien',
    });
  } else {
    store.addColumnMappingRule({
      excelHeaderPattern: key.trim(),
      targetSourceField: value.trim(),
      learnedFrom: 'Ajout manuel Pharmacien',
    });
  }
  res.json({ learnedMemory: store.getMemory() });
});

app.delete('/api/training/rules/:id', (req, res) => {
  store.deleteMemoryRule(req.params.id);
  res.json({ learnedMemory: store.getMemory() });
});

app.post('/api/training/software-profiles', (req, res) => {
  const {
    softwareName,
    pharmacyId,
    detectedSoftwareType,
    elements,
    injectionScript,
  } = req.body as {
    softwareName: string;
    pharmacyId: string;
    detectedSoftwareType: 'erp_form' | 'excel_grid' | 'desktop_app';
    elements: GroundedTargetElement[];
    injectionScript: string;
  };

  if (!softwareName?.trim() || !Array.isArray(elements)) {
    res.status(400).json({ error: 'Nom du logiciel et éléments détectés requis.' });
    return;
  }

  const profile = store.saveSoftwareProfile({
    softwareName: softwareName.trim(),
    pharmacyId,
    detectedSoftwareType: detectedSoftwareType || 'erp_form',
    elements,
    injectionScript: injectionScript || '',
  });

  res.status(201).json({ profile, learnedMemory: store.getMemory() });
});

app.get('/api/pharmacies/:id/installer', (req, res) => {
  const pharmacy = store.getPharmacy(req.params.id);
  if (!pharmacy) {
    res.status(404).json({ error: 'Officine introuvable.' });
    return;
  }
  const serverOrigin =
    process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  const localAgentPath = path.resolve(__dirname, 'backend-fastapi/pharmagent_local_agent.py');
  const guardrailPath = path.resolve(__dirname, 'backend-fastapi/app/safety_guardrail.py');
  const localCode = fs.existsSync(localAgentPath)
    ? fs.readFileSync(localAgentPath, 'utf-8')
    : '';
  const guardrailCode = fs.existsSync(guardrailPath)
    ? fs.readFileSync(guardrailPath, 'utf-8')
    : '';

  const bundledScript = `"""
====================================================================
PHARMAGENT — INSTALLEUR AGENT LOCAL PRÉ-CONFIGURÉ
Officine : ${pharmacy.name} (${pharmacy.city})
Titulaire : ${pharmacy.pharmacist}
Logiciel cible : ${pharmacy.targetSoftware}
Clé d'appairage : ${pharmacy.agentKey}
Serveur Central : ${serverOrigin}

Lancement sur le PC de la pharmacie :
  pip install requests pyautogui pillow
  python pharmagent_${pharmacy.id}.py
====================================================================
"""

import re
import time
import io
import base64
from dataclasses import dataclass
from typing import List, Optional
import requests
import pyautogui
from PIL import ImageGrab

SERVER_URL = ${JSON.stringify(serverOrigin)}
AGENT_KEY = ${JSON.stringify(pharmacy.agentKey)}

# --- GARDE-FOU DE SÉCURITÉ ABSOLU (BROUILLON UNIQUEMENT) ---
${guardrailCode.replace(/^import .*\n/gm, '').replace(/^from .*\n/gm, '')}

def capture_screen_base64() -> str:
    screenshot = ImageGrab.grab()
    buf = io.BytesIO()
    screenshot.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")

def run():
    guardrail = DraftOnlyGuardrail()
    screen_w, screen_h = pyautogui.size()
    print(f"[PharmAgent] Poste ${pharmacy.name} connecté à {SERVER_URL} ({screen_w}x{screen_h})")
    while True:
        try:
            resp = requests.get(f"{SERVER_URL.rstrip('/')}/api/agent-client/next-task", params={"agentKey": AGENT_KEY}, timeout=15)
            payload = resp.json()
            task = payload.get("task")
            if not task:
                time.sleep(4)
                continue

            profile = payload.get("softwareProfile")
            if profile and profile.get("elements"):
                print(f"[Profil mémorisé trouvé] Utilisation directe de '{profile['softwareName']}'")
                elements = profile["elements"]
            else:
                print("[UI Grounding] Analyse de l'écran en direct via Gemini Vision...")
                shot = capture_screen_base64()
                gr = requests.post(
                    f"{SERVER_URL.rstrip('/')}/api/agent/ground",
                    json={"pharmacyId": task["pharmacyId"], "extractedData": task["extracted"], "screenshotBase64": shot, "mimeType": "image/png"},
                    timeout=60,
                )
                elements = gr.json()["grounding"]["elements"]

            for elem in elements:
                if elem.get("safetyStatus") == "FORBIDDEN_BY_GUARDRAIL" or elem.get("elementRole") == "forbidden_final_button":
                    print(f"[GARDE-FOU] Bouton final ignoré et verrouillé : {elem.get('detectedLabel')}")
                    continue
                guardrail.assert_element_safe(elem["elementRole"], elem["detectedLabel"], elem.get("safetyStatus"))
                cx = int((elem["centerPoint"]["x"] / 1000.0) * screen_w)
                cy = int((elem["centerPoint"]["y"] / 1000.0) * screen_h)
                if elem["elementRole"] in ("input_field", "table_column") and elem.get("semanticMapping"):
                    val = str(elem["semanticMapping"]["sampleValueToInsert"])
                    pyautogui.click(cx, cy)
                    pyautogui.write(val, interval=0.02)
                elif elem["elementRole"] == "draft_button":
                    pyautogui.click(cx, cy)
                    break

            requests.post(
                f"{SERVER_URL.rstrip('/')}/api/agent-client/report",
                json={"taskId": task["id"], "status": "BROUILLON_CREE_LOCALEMENT", "report": "Saisie exécutée. Arrêt strict au Brouillon."},
                timeout=15,
            )
        except KeyboardInterrupt:
            break
        except Exception as exc:
            print(f"[Info/Erreur] {exc}")
            time.sleep(5)

if __name__ == "__main__":
    run()
`;

  const fileName = `pharmagent_${pharmacy.id}.py`;
  res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(bundledScript || localCode);
});

app.post('/api/agent/run-task', async (req, res) => {
  try {
    const {
      pharmacyId,
      taskPrompt,
      documentHint = 'bon_livraison',
      imageBase64,
      sampleAssetPath,
      mimeType,
      targetMode = 'erp_live',
      uploadedExcelBase64,
      uploadedExcelName,
    } = req.body as {
      pharmacyId: string;
      taskPrompt: string;
      documentHint?: DocumentCategory;
      imageBase64?: string;
      sampleAssetPath?: string;
      mimeType?: string;
      targetMode?: TargetExecutionMode;
      uploadedExcelBase64?: string;
      uploadedExcelName?: string;
    };

    const pharmacy = store.getPharmacy(pharmacyId);
    if (!pharmacy) {
      res.status(404).json({ error: 'Officine introuvable.' });
      return;
    }

    const learnedMemory = store.getMemory();
    const image = resolveImagePayload(imageBase64, sampleAssetPath, mimeType || 'image/jpeg');
    const { data: extracted, tokensConsumed: extractTokens } = await extractDocumentWithGemini({
      imageBase64: image.base64,
      mimeType: image.mimeType,
      documentHint,
      taskPrompt,
      learnedMemory,
    });

    let totalTokens = extractTokens;
    store.recordVisionUsage(pharmacy.id, extractTokens, extracted.documentType || documentHint);

    const draftId = `DRF-${Date.now().toString().slice(-6)}`;
    let draftFileName: string | undefined;
    let draftArtifactUrl: string | undefined;
    let excelColumnsMapped: Array<{ excelColumn: string; sourceField: string }> | undefined;
    let excelPreviewHeaders: string[] | undefined;
    let excelPreviewRows: Array<Record<string, unknown>> | undefined;
    let learnedColumnsCount = 0;

    if (targetMode === 'excel_upload' && uploadedExcelBase64) {
      const cleanB64 = uploadedExcelBase64.replace(/^data:[^;]+;base64,/, '');
      const wb = XLSX.read(Buffer.from(cleanB64, 'base64'), { type: 'buffer' });
      const firstSheetName = wb.SheetNames[0];
      const ws = wb.Sheets[firstSheetName];
      const existingRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const headerMatrix = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
      const excelHeaders = (headerMatrix[0] || []).map((h) => String(h).trim()).filter(Boolean);

      if (excelHeaders.length > 0) {
        const mapped = await mapToRealExcelColumnsWithGemini({
          excelColumns: excelHeaders,
          extractedData: extracted,
          learnedMemory,
        });
        totalTokens += mapped.tokensConsumed;
        store.recordVisionUsage(pharmacy.id, mapped.tokensConsumed);
        excelColumnsMapped = mapped.mappings;
        learnedColumnsCount = store.learnFromExcelMappings(
          mapped.mappings,
          uploadedExcelName || 'Excel_Officine.xlsx'
        );

        const hasStatusColumn = mapped.mappings.some((m) => m.sourceField === 'draftStatus');
        const newRows = extracted.lineItems.map((item) => {
          const rowObj: Record<string, unknown> = {};
          for (const col of excelHeaders) {
            const match = mapped.mappings.find((m) => m.excelColumn === col);
            rowObj[col] = match
              ? resolveSourceFieldValue(extracted, item, match.sourceField)
              : '';
          }
          if (!hasStatusColumn) {
            rowObj['Statut PharmAgent'] = 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN';
          }
          return rowObj;
        });

        const finalHeaders = hasStatusColumn
          ? excelHeaders
          : [...excelHeaders, 'Statut PharmAgent'];
        excelPreviewHeaders = finalHeaders;
        excelPreviewRows = newRows;

        const updatedWs = XLSX.utils.json_to_sheet([...existingRows, ...newRows]);
        wb.Sheets[firstSheetName] = updatedWs;
      } else {
        const fallbackRows = extracted.lineItems.map((item) => ({
          'N° Document': extracted.documentNumber,
          Fournisseur: extracted.supplierOrOrg,
          Date: extracted.documentDate,
          Désignation: item.designation,
          Quantité: item.quantity,
          Lot: item.lotNumber || 'N/A',
          Expiration: item.expiryDate || 'N/A',
          'Prix Unitaire (FCFA)': item.unitPriceFCFA,
          Statut: 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN',
        }));
        excelPreviewHeaders = Object.keys(fallbackRows[0] || {});
        excelPreviewRows = fallbackRows;
        wb.Sheets[firstSheetName] = XLSX.utils.json_to_sheet(fallbackRows);
      }

      const outBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      const baseName = (uploadedExcelName || 'Stock_Officine.xlsx').replace(/\.xlsx$/i, '');
      draftFileName = `${baseName}_BROUILLON_${extracted.documentNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`;
      store.saveDraftArtifact(draftId, draftFileName, outBuffer);
      draftArtifactUrl = `/api/drafts/${draftId}/download`;
    } else {
      const wb = XLSX.utils.book_new();
      const rows = extracted.lineItems.map((item) => ({
        'N° Document': extracted.documentNumber,
        'Fournisseur / Organisme': extracted.supplierOrOrg,
        Date: extracted.documentDate,
        'Désignation Médicament': item.designation,
        Quantité: item.quantity,
        'N° Lot': item.lotNumber || 'N/A',
        'Date Exp.': item.expiryDate || 'N/A',
        'Prix Unitaire (FCFA)': item.unitPriceFCFA,
        'Statut Saisie PharmAgent': 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'BROUILLON_STOCK');
      const outBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      draftFileName = `BROUILLON_${pharmacy.id}_${extracted.documentNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`;
      store.saveDraftArtifact(draftId, draftFileName, outBuffer);
      draftArtifactUrl = `/api/drafts/${draftId}/download`;
    }

    if (targetMode === 'local_desktop') {
      store.enqueueDesktopTask({
        id: `TSK-${Date.now().toString().slice(-6)}`,
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        createdAt: new Date().toISOString(),
        taskPrompt,
        extracted,
        status: 'EN_ATTENTE_AGENT_LOCAL',
      });
    }

    const guardrailNote =
      targetMode === 'local_desktop'
        ? `Tâche transmise à l'agent desktop (${pharmacy.targetSoftware}) et brouillon sauvegardé. Validation finale bloquée.`
        : targetMode === 'excel_upload'
        ? `Lignes injectées dans votre classeur Excel avec statut BROUILLON${
            learnedColumnsCount > 0 ? ` (+${learnedColumnsCount} nouvelle(s) colonne(s) mémorisée(s))` : ''
          }. Validation finale bloquée.`
        : `Brouillon enregistré dans ERP Officine Intégré pour ${pharmacy.name}. Validation finale réservée au pharmacien.`;

    const draft: DraftRecord = {
      id: draftId,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      createdAt: new Date().toISOString(),
      taskPrompt: taskPrompt || 'Extraction et mise en brouillon de réception.',
      targetMode,
      status: 'BROUILLON',
      extracted: { ...extracted, tokensConsumed: totalTokens },
      draftArtifactUrl,
      draftFileName,
      excelColumnsMapped,
      excelPreviewHeaders,
      excelPreviewRows,
      guardrailNote,
    };

    store.saveDraft(draft);
    store.recordExecutionOutcome({
      pharmacyId: pharmacy.id,
      documentNumber: extracted.documentNumber,
      documentType: extracted.documentType || documentHint,
      tokensUsed: totalTokens,
      blocked: false,
      guardrailMessage: guardrailNote,
    });

    res.json({ draft, tokensConsumed: totalTokens, learnedColumnsCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors du traitement de la mission.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/drafts/:draftId/approve', (req, res) => {
  try {
    const { lineItems, pharmacistName } = req.body as {
      lineItems?: ExtractedLineItem[];
      pharmacistName?: string;
    };
    const updated = store.approveDraftByPharmacist(
      req.params.draftId,
      lineItems,
      pharmacistName
    );
    res.json({ draft: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de la validation humaine.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/drafts/:draftId/reject', (req, res) => {
  try {
    const updated = store.rejectDraft(req.params.draftId);
    res.json({ draft: updated });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors du rejet.';
    res.status(400).json({ error: message });
  }
});

app.get('/api/agent-client/next-task', (req, res) => {
  const agentKey = String(req.query.agentKey || '');
  if (!agentKey) {
    res.status(400).json({ error: 'agentKey manquant.' });
    return;
  }
  const pharmacy = store.getPharmacyByAgentKey(agentKey);
  const task = store.getNextDesktopTask(agentKey);
  const softwareProfile = pharmacy
    ? (store.getMemory().softwareProfiles || []).find((p) => p.pharmacyId === pharmacy.id) || null
    : null;
  res.json({ task, softwareProfile });
});

app.post('/api/agent-client/report', (req, res) => {
  const { taskId, status, report } = req.body as {
    taskId: string;
    status: 'BROUILLON_CREE_LOCALEMENT' | 'BLOQUE_GARDE_FOU';
    report: string;
  };
  const updated = store.completeDesktopTask(taskId, status, report);
  if (!updated) {
    res.status(404).json({ error: 'Tâche introuvable.' });
    return;
  }
  res.json({ task: updated });
});

app.post('/api/agent/extract', async (req, res) => {
  try {
    const {
      pharmacyId,
      documentHint = 'bon_livraison',
      imageBase64,
      sampleAssetPath,
      mimeType,
      taskPrompt,
    } = req.body as {
      pharmacyId: string;
      documentHint?: DocumentCategory;
      imageBase64?: string;
      sampleAssetPath?: string;
      mimeType?: string;
      taskPrompt?: string;
    };

    const image = resolveImagePayload(imageBase64, sampleAssetPath, mimeType || 'image/jpeg');
    const { data, tokensConsumed } = await extractDocumentWithGemini({
      imageBase64: image.base64,
      mimeType: image.mimeType,
      documentHint,
      taskPrompt,
      learnedMemory: store.getMemory(),
    });

    store.recordVisionUsage(pharmacyId, tokensConsumed, data.documentType || documentHint);

    res.json({
      extracted: data,
      tokensConsumed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors de l’extraction Gemini Vision.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/agent/ground', async (req, res) => {
  try {
    const {
      pharmacyId,
      extractedData,
      screenshotBase64,
      sampleAssetPath,
      mimeType,
    } = req.body as {
      pharmacyId: string;
      extractedData: ExtractedDocumentData;
      screenshotBase64?: string;
      sampleAssetPath?: string;
      mimeType?: string;
    };

    if (!extractedData) {
      res.status(400).json({ error: 'Données extraites manquantes pour le UI Grounding.' });
      return;
    }

    const screenshot = resolveImagePayload(
      screenshotBase64,
      sampleAssetPath,
      mimeType || 'image/jpeg'
    );

    const { result, tokensConsumed } = await groundTargetInterfaceWithGemini({
      screenshotBase64: screenshot.base64,
      mimeType: screenshot.mimeType,
      extractedData,
    });

    store.recordVisionUsage(pharmacyId, tokensConsumed);

    res.json({
      grounding: result,
      tokensConsumed,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur lors du UI Grounding.';
    res.status(500).json({ error: message });
  }
});

app.post('/api/agent/execute-draft', (req, res) => {
  try {
    const {
      pharmacyId,
      extractedData,
      elements,
      attemptFinalValidation = false,
      targetSoftwareType = 'erp_form',
    } = req.body as {
      pharmacyId: string;
      extractedData: ExtractedDocumentData;
      elements: GroundedTargetElement[];
      attemptFinalValidation?: boolean;
      targetSoftwareType?: 'erp_form' | 'excel_grid' | 'desktop_app';
    };

    const pharmacy = store.getPharmacy(pharmacyId);
    if (!pharmacy) {
      res.status(404).json({ error: 'Officine introuvable.' });
      return;
    }

    const runId = `RUN-${Date.now().toString().slice(-6)}`;
    const steps: ExecutionStepLog[] = [];
    let stepCounter = 1;
    let guardrailTriggered = false;
    let guardrailReport =
      'Politique BROUILLON UNIQUEMENT respectée : arrêt strict avant toute validation finale.';

    steps.push({
      stepIndex: stepCounter++,
      action: 'FOCUS_WINDOW',
      targetLabel: pharmacy.targetSoftware,
      status: 'EXECUTED',
      message: `Fenêtre cible activée pour ${pharmacy.name} (${pharmacy.city}).`,
      timestamp: new Date().toISOString(),
    });

    const inputElements = elements.filter(
      (e) => e.elementRole === 'input_field' || e.elementRole === 'table_column'
    );
    const draftButtons = elements.filter((e) => e.elementRole === 'draft_button');
    const forbiddenButtons = elements.filter(
      (e) => e.elementRole === 'forbidden_final_button' || e.safetyStatus === 'FORBIDDEN_BY_GUARDRAIL'
    );

    const pythonLines: string[] = [
      '# Script généré dynamiquement par PharmAgent UI Grounding',
      'import pyautogui, time',
      'from app.safety_guardrail import DraftOnlyGuardrail, SafetyViolationError',
      '',
      'guardrail = DraftOnlyGuardrail()',
      `# Officine : ${pharmacy.name} (${pharmacy.city}) — Logiciel : ${pharmacy.targetSoftware}`,
    ];

    for (const el of inputElements) {
      guardrail.assertElementSafe(el);
      const value = el.semanticMapping?.sampleValueToInsert ?? '';
      const px = Math.round((el.centerPoint.x / 1000) * 1920);
      const py = Math.round((el.centerPoint.y / 1000) * 1080);

      steps.push({
        stepIndex: stepCounter++,
        action: targetSoftwareType === 'excel_grid' ? 'WRITE_EXCEL_CELL' : 'CLICK_AND_TYPE',
        targetLabel: el.detectedLabel,
        coordinates: el.centerPoint,
        valueInserted: value,
        status: 'EXECUTED',
        message: `Insertion de "${value}" dans [${el.detectedLabel}] aux coordonnées normalisées (${el.centerPoint.x}, ${el.centerPoint.y}).`,
        timestamp: new Date().toISOString(),
      });

      pythonLines.push(
        `pyautogui.click(${px}, ${py})  # ${el.detectedLabel}`,
        `pyautogui.write(${JSON.stringify(value)}, interval=0.02)`
      );
    }

    if (attemptFinalValidation) {
      const targetForbidden = forbiddenButtons[0] ?? {
        elementRole: 'forbidden_final_button' as const,
        detectedLabel: 'Valider Définitivement',
        safetyStatus: 'FORBIDDEN_BY_GUARDRAIL' as const,
        centerPoint: { x: 900, y: 940 },
      };

      try {
        guardrail.assertElementSafe(targetForbidden);
      } catch (err) {
        if (err instanceof SafetyViolationError) {
          guardrailTriggered = true;
          guardrailReport = err.message;
          steps.push({
            stepIndex: stepCounter++,
            action: 'BLOCK_FINAL_VALIDATION',
            targetLabel: targetForbidden.detectedLabel,
            coordinates: targetForbidden.centerPoint,
            status: 'BLOCKED_BY_GUARDRAIL',
            message: err.message,
            timestamp: new Date().toISOString(),
          });
          pythonLines.push(
            '',
            `# TENTATIVE DE VALIDATION FINALE INTERCEPTÉE :`,
            `guardrail.assert_element_safe("forbidden_final_button", ${JSON.stringify(targetForbidden.detectedLabel)})  # -> Lève SafetyViolationError !`
          );
        }
      }
    } else {
      const draftBtn = draftButtons[0];
      const draftLabel = draftBtn?.detectedLabel ?? 'Enregistrer Brouillon';
      if (draftBtn) {
        guardrail.assertElementSafe(draftBtn);
      }
      steps.push({
        stepIndex: stepCounter++,
        action: 'CLICK_SAVE_DRAFT',
        targetLabel: draftLabel,
        coordinates: draftBtn?.centerPoint ?? { x: 730, y: 940 },
        status: 'STOPPED_AT_DRAFT',
        message: `Action "${draftLabel}" exécutée. Cycle agent terminé — validation définitive bloquée par défaut.`,
        timestamp: new Date().toISOString(),
      });

      if (forbiddenButtons.length > 0) {
        for (const fb of forbiddenButtons) {
          steps.push({
            stepIndex: stepCounter++,
            action: 'BLOCK_FINAL_VALIDATION',
            targetLabel: fb.detectedLabel,
            coordinates: fb.centerPoint,
            status: 'BLOCKED_BY_GUARDRAIL',
            message: `Bouton "${fb.detectedLabel}" verrouillé par le Garde-Fou Absolu (validation pharmacien obligatoire).`,
            timestamp: new Date().toISOString(),
          });
        }
      }

      pythonLines.push(
        '',
        `# ARRÊT STRICT AU STADE BROUILLON`,
        `guardrail.assert_element_safe("draft_button", ${JSON.stringify(draftLabel)})`,
        `# Clic sur "${draftLabel}" uniquement. Validation finale interdite.`
      );
    }

    const wb = XLSX.utils.book_new();
    const rows = (extractedData.lineItems || []).map((item) => ({
      'N° Document': extractedData.documentNumber,
      'Fournisseur / Organisme': extractedData.supplierOrOrg,
      Date: extractedData.documentDate,
      'Désignation Médicament': item.designation,
      Quantité: item.quantity,
      'N° Lot': item.lotNumber || 'N/A',
      'Date Exp.': item.expiryDate || 'N/A',
      'Prix Unitaire (FCFA)': item.unitPriceFCFA,
      'Sous-total (FCFA)': item.quantity * item.unitPriceFCFA,
      'Statut Saisie PharmAgent': 'BROUILLON - EN ATTENTE VALIDATION PHARMACIEN',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'BROUILLON_STOCK');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const draftFileName = `BROUILLON_${pharmacy.id}_${extractedData.documentNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.xlsx`;
    store.saveDraftArtifact(runId, draftFileName, xlsxBuffer);

    if (!guardrailTriggered) {
      store.saveDraft({
        id: runId,
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        createdAt: new Date().toISOString(),
        taskPrompt: 'Saisie par UI Grounding sur capture écran cible.',
        targetMode: 'erp_live',
        status: 'BROUILLON',
        extracted: extractedData,
        draftArtifactUrl: `/api/drafts/${runId}/download`,
        draftFileName,
        guardrailNote: guardrailReport,
      });
    }

    store.recordExecutionOutcome({
      pharmacyId: pharmacy.id,
      documentNumber: extractedData.documentNumber,
      documentType: extractedData.documentType || 'bon_livraison',
      tokensUsed: extractedData.tokensConsumed ?? 2100,
      blocked: guardrailTriggered,
      guardrailMessage: guardrailReport,
    });

    const result: ExecutionRunResult = {
      runId,
      pharmacyId: pharmacy.id,
      pharmacyName: pharmacy.name,
      documentNumber: extractedData.documentNumber,
      finalState: guardrailTriggered ? 'SECURITY_VIOLATION_BLOCKED' : 'DRAFT_SAVED_ONLY',
      draftArtifactUrl: `/api/drafts/${runId}/download`,
      draftFileName,
      steps,
      guardrailTriggered,
      guardrailReport,
      pythonScriptPreview: pythonLines.join('\n'),
    };

    res.json(result);
  } catch (err: unknown) {
    if (err instanceof SafetyViolationError) {
      res.status(403).json({ error: err.message, guardrailTriggered: true });
      return;
    }
    const message = err instanceof Error ? err.message : 'Erreur d’exécution Brouillon.';
    res.status(500).json({ error: message });
  }
});

app.get('/api/drafts/:draftId/download', (req, res) => {
  const artifact = store.getDraftArtifact(req.params.draftId);
  if (!artifact) {
    res.status(404).json({ error: 'Fichier Brouillon introuvable ou expiré.' });
    return;
  }
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${artifact.fileName}"`);
  res.send(artifact.buffer);
});

app.get('/api/fastapi-sources', (_req, res) => {
  const fastapiDir = path.resolve(__dirname, 'backend-fastapi');
  const relativeFiles = [
    'requirements.txt',
    'pharmagent_local_agent.py',
    'app/main.py',
    'app/vision_extractor.py',
    'app/ui_grounding.py',
    'app/safety_guardrail.py',
    'app/executor.py',
  ];

  const files = relativeFiles
    .map((rel) => {
      const fullPath = path.join(fastapiDir, rel);
      if (!fs.existsSync(fullPath)) return null;
      return {
        path: `backend-fastapi/${rel}`,
        language: rel.endsWith('.py') ? 'python' : 'text',
        content: fs.readFileSync(fullPath, 'utf-8'),
      };
    })
    .filter(Boolean);

  res.json({ files });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint API introuvable.' });
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`PharmAgent server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
