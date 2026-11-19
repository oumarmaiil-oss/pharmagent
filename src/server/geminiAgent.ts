// ============================================================
// PharmAgent — Agent Gemini Vision
// ============================================================

import { GoogleGenAI, Type } from '@google/genai';
import type {
  DocumentCategory,
  ExtractedDocumentData,
  GroundingAnalysisResult,
  TargetSoftwareType,
} from '../types/pharmagent.ts';

// Modèle configurable via GEMINI_MODEL, défaut gemini-2.0-flash (multimodal, rapide)
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY manquante. Ajoutez-la dans les variables d'environnement (Render > Environment)."
    );
  }
  return new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'PharmAgent/2.0' } } });
}

// ─── Extraction de document ───────────────────────────────

export async function extractDocumentWithGemini(params: {
  imageBase64: string;
  mimeType: string;
  documentHint: DocumentCategory;
  taskPrompt?: string;
}): Promise<{ data: ExtractedDocumentData; tokensConsumed: number }> {
  const ai = getClient();

  const missionClause = params.taskPrompt?.trim()
    ? `\nInstruction spécifique : "${params.taskPrompt.trim()}". Réponds dans agentObservations.`
    : '';

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: {
      parts: [
        { inlineData: { mimeType: params.mimeType, data: params.imageBase64 } },
        {
          text:
            `Tu es l'agent PharmAgent d'une officine pharmaceutique. ` +
            `Analyse ce document (type probable : ${params.documentHint}). ` +
            `Extrais l'en-tête (numéro, fournisseur/organisme, pharmacie destinataire, date, montant total FCFA) ` +
            `et chaque ligne : désignation recopiée EXACTEMENT comme imprimée (abréviations comprises, ne corrige rien), ` +
            `code CIP/EAN s'il figure sur la ligne, quantité entière, N° lot, date expiration, ` +
            `prix unitaire d'achat FCFA, prix public/vente FCFA s'il figure.` +
            missionClause,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentType: { type: Type.STRING },
          documentNumber: { type: Type.STRING },
          supplierOrOrg: { type: Type.STRING },
          recipientPharmacy: { type: Type.STRING },
          documentDate: { type: Type.STRING },
          currency: { type: Type.STRING },
          totalAmountFCFA: { type: Type.NUMBER },
          agentObservations: { type: Type.STRING },
          lineItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                designation: { type: Type.STRING },
                cip: { type: Type.STRING },
                quantity: { type: Type.INTEGER },
                lotNumber: { type: Type.STRING },
                expiryDate: { type: Type.STRING },
                unitPriceFCFA: { type: Type.NUMBER },
                salePriceFCFA: { type: Type.NUMBER },
                confidence: { type: Type.NUMBER },
              },
              required: ['designation', 'quantity', 'unitPriceFCFA', 'confidence'],
            },
          },
        },
        required: ['documentType', 'documentNumber', 'supplierOrOrg', 'recipientPharmacy', 'documentDate', 'totalAmountFCFA', 'lineItems'],
      },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) throw new Error('Réponse vide de Gemini Vision.');

  let parsed: ExtractedDocumentData;
  try {
    parsed = JSON.parse(text) as ExtractedDocumentData;
  } catch {
    throw new Error(`Réponse Gemini non-JSON : ${text.slice(0, 200)}`);
  }

  const tokens = response.usageMetadata?.totalTokenCount ?? 0;
  return { data: parsed, tokensConsumed: tokens };
}

// ─── Analyse UI Grounding ─────────────────────────────────

export async function groundTargetInterfaceWithGemini(params: {
  imageBase64: string;
  mimeType: string;
  targetSoftware: TargetSoftwareType;
}): Promise<GroundingAnalysisResult> {
  const ai = getClient();

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: {
      parts: [
        { inlineData: { mimeType: params.mimeType, data: params.imageBase64 } },
        {
          text:
            `Tu es l'agent de sécurité PharmAgent. Analyse cette capture d'écran de l'interface "${params.targetSoftware}". ` +
            `Identifie tous les boutons et champs interactifs. ` +
            `Classe chaque élément : SAFE_DRAFT (brouillon/sauvegarder temporairement), ` +
            `FORBIDDEN_BY_GUARDRAIL (valider/confirmer/soumettre/enregistrer définitivement/clôturer), ` +
            `ou UNKNOWN. ` +
            `La règle absolue : l'agent ne doit JAMAIS cliquer sur un bouton FORBIDDEN.`,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          elements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                elementRole: { type: Type.STRING },
                detectedLabel: { type: Type.STRING },
                safetyStatus: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
                suggestedAction: { type: Type.STRING },
              },
              required: ['elementRole', 'detectedLabel', 'safetyStatus', 'confidence', 'suggestedAction'],
            },
          },
          overallSafe: { type: Type.BOOLEAN },
          observations: { type: Type.STRING },
        },
        required: ['elements', 'overallSafe', 'observations'],
      },
    },
  });

  const text = (response.text ?? '').trim();
  if (!text) throw new Error('Réponse vide de Gemini Grounding.');

  const parsed = JSON.parse(text);
  const tokens = response.usageMetadata?.totalTokenCount ?? 0;

  return {
    targetSoftware: params.targetSoftware,
    elements: parsed.elements ?? [],
    overallSafe: parsed.overallSafe ?? false,
    observations: parsed.observations ?? '',
    tokensConsumed: tokens,
  };
}

// ─── RPA : actions à exécuter sur l'écran ─────────────────

export interface RPAAction {
  step: number;
  action: 'click' | 'type' | 'hotkey' | 'screenshot_verify';
  x?: number;
  y?: number;
  text?: string;
  keys?: string[];
  fieldLabel: string;
  value?: string;
  safetyStatus: 'SAFE_DRAFT' | 'FORBIDDEN_BY_GUARDRAIL';
}

export async function getRPAActionsFromGemini(params: {
  screenshotBase64: string;
  mimeType: string;
  targetSoftware: string;
  extractedData: ExtractedDocumentData;
  currentLineIndex: number;
}): Promise<{ actions: RPAAction[]; allSafe: boolean; observations: string; tokensConsumed: number }> {
  const ai = getClient();

  const line = params.extractedData.lineItems[params.currentLineIndex];
  const lineJson = JSON.stringify(line ?? {});

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: {
      parts: [
        { inlineData: { mimeType: params.mimeType, data: params.screenshotBase64 } },
        {
          text:
            `Tu es l'agent RPA PharmAgent. Logiciel : "${params.targetSoftware}".\n` +
            `Données à saisir pour la ligne ${params.currentLineIndex + 1} : ${lineJson}\n` +
            `Analyse la capture d'écran et retourne la séquence d'actions pour saisir cette ligne en brouillon.\n` +
            `RÈGLE ABSOLUE : safetyStatus = FORBIDDEN_BY_GUARDRAIL pour tout bouton Valider/Confirmer/Soumettre/Enregistrer définitivement. ` +
            `N'inclure JAMAIS une action FORBIDDEN dans la séquence. ` +
            `Utilise les coordonnées pixel (x, y) visibles à l'écran. ` +
            `Pour chaque champ : click sur le champ puis type la valeur. ` +
            `Termine par screenshot_verify pour confirmer la saisie.`,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          allSafe: { type: Type.BOOLEAN },
          observations: { type: Type.STRING },
          actions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                step: { type: Type.INTEGER },
                action: { type: Type.STRING },
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                text: { type: Type.STRING },
                keys: { type: Type.ARRAY, items: { type: Type.STRING } },
                fieldLabel: { type: Type.STRING },
                value: { type: Type.STRING },
                safetyStatus: { type: Type.STRING },
              },
              required: ['step', 'action', 'fieldLabel', 'safetyStatus'],
            },
          },
        },
        required: ['allSafe', 'observations', 'actions'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '').trim());
  const tokens = response.usageMetadata?.totalTokenCount ?? 0;

  // Guardrail côté serveur : éliminer toute action FORBIDDEN
  const safeActions = (parsed.actions as RPAAction[]).filter(
    (a) => a.safetyStatus !== 'FORBIDDEN_BY_GUARDRAIL'
  );

  return {
    actions: safeActions,
    allSafe: parsed.allSafe ?? false,
    observations: parsed.observations ?? '',
    tokensConsumed: tokens,
  };
}

// ─── Correspondance produits ambigus (un seul appel par document) ─

export async function resolveProductMatchesWithGemini(params: {
  supplier: string;
  items: Array<{
    index: number;
    designation: string;
    unitPriceFCFA: number;
    salePriceFCFA?: number;
    candidates: Array<{ productId: string; erpLabel: string }>;
  }>;
}): Promise<{ decisions: Array<{ index: number; productId: string; confidence: number }>; tokensConsumed: number }> {
  if (!params.items.length) return { decisions: [], tokensConsumed: 0 };
  const ai = getClient();

  const payload = params.items.map((it) => ({
    index: it.index,
    libelle_grossiste: it.designation,
    prix_achat: it.unitPriceFCFA,
    prix_vente: it.salePriceFCFA,
    candidats: it.candidates.map((c) => ({ id: c.productId, libelle_erp: c.erpLabel })),
  }));

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: {
      parts: [{
        text:
          `Tu es pharmacien expert en nomenclature. Grossiste : "${params.supplier}".\n` +
          `Pour chaque ligne de bon de livraison, choisis parmi les candidats le produit ERP identique ` +
          `(même molécule ou marque équivalente, même dosage, même forme, même conditionnement). ` +
          `Une marque et son générique NE sont PAS le même produit sauf si le libellé ERP est la même marque. ` +
          `Si aucun candidat n'est identique, renvoie productId vide. confidence entre 0 et 1, sois strict.\n` +
          JSON.stringify(payload),
      }],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          decisions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                index: { type: Type.INTEGER },
                productId: { type: Type.STRING },
                confidence: { type: Type.NUMBER },
              },
              required: ['index', 'productId', 'confidence'],
            },
          },
        },
        required: ['decisions'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '').trim() || '{"decisions":[]}');
  const allowed = new Map(params.items.map((it) => [it.index, new Set(it.candidates.map((c) => c.productId))]));
  // Ne garder que des choix parmi les candidats proposés
  const decisions = (parsed.decisions ?? []).filter(
    (d: { index: number; productId: string }) => d.productId && allowed.get(d.index)?.has(d.productId)
  );
  return { decisions, tokensConsumed: response.usageMetadata?.totalTokenCount ?? 0 };
}
