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

// Modèle configurable via GEMINI_MODEL. Google retire régulièrement des modèles :
// en cas de « modèle introuvable », on bascule sur le suivant et on le retient.
const MODEL_CHAIN = [...new Set([process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-flash-latest'].filter((m): m is string => !!m))];
let activeModel = MODEL_CHAIN[0];

type GenerateParams = Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>;

async function generate(ai: GoogleGenAI, params: GenerateParams) {
  const start = MODEL_CHAIN.indexOf(activeModel);
  let lastErr: unknown;
  for (const model of MODEL_CHAIN.slice(start)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await ai.models.generateContent({ ...params, model });
        if (model !== activeModel) {
          console.warn(`[PharmAgent] Modèle Gemini « ${activeModel} » indisponible : bascule sur « ${model} ».`);
          activeModel = model;
        }
        return res;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/NOT_FOUND|no longer available|is not found|not supported for generateContent/i.test(msg)) break;
        // Surcharge passagère côté Google : on réessaie, puis on passe au modèle suivant
        if (/UNAVAILABLE|overloaded|high demand|RESOURCE_EXHAUSTED|\b(429|500|503)\b/i.test(msg)) {
          if (attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
          break;
        }
        throw err;
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  if (/UNAVAILABLE|overloaded|high demand|RESOURCE_EXHAUSTED|429|503/i.test(msg)) {
    throw new Error("Le service d'IA de Google est momentanément surchargé. Réessayez dans une minute.");
  }
  throw lastErr;
}

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

  const response = await generate(ai, {
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

  const response = await generate(ai, {
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

  const response = await generate(ai, {
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
