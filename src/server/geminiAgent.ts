// ============================================================
// PharmAgent — Agent Gemini Vision
// ============================================================

import { GoogleGenAI, Type } from '@google/genai';
import type {
  AgentLearnedMemory,
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
  learnedMemory?: AgentLearnedMemory;
}): Promise<{ data: ExtractedDocumentData; tokensConsumed: number }> {
  const ai = getClient();

  const memoryClause =
    params.learnedMemory && params.learnedMemory.productAliases.length > 0
      ? '\nMémoire produits (normalise vers le nom canonique si correspondance) :\n' +
        params.learnedMemory.productAliases
          .slice(0, 40)
          .map((p) => `- "${p.rawLabel}" => "${p.canonicalName}"`)
          .join('\n')
      : '';

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
            `et chaque ligne (désignation exacte, quantité entière, N° lot, date expiration, prix unitaire FCFA).` +
            memoryClause + missionClause,
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
                quantity: { type: Type.INTEGER },
                lotNumber: { type: Type.STRING },
                expiryDate: { type: Type.STRING },
                unitPriceFCFA: { type: Type.NUMBER },
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

// ─── Mapping vers colonnes cibles ─────────────────────────

export async function mapToTargetColumnsWithGemini(params: {
  extractedData: ExtractedDocumentData;
  targetSoftware: TargetSoftwareType;
  knownColumns?: string[];
}): Promise<{ mappings: Array<{ sourceField: string; targetColumn: string; exampleValue: string }>; tokensConsumed: number }> {
  const ai = getClient();

  const colHint = params.knownColumns?.length
    ? `\nColonnes connues du logiciel cible : ${params.knownColumns.join(', ')}.`
    : '';

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: {
      parts: [
        {
          text:
            `Tu es l'agent PharmAgent. Voici les données extraites d'un document pharmaceutique :\n` +
            JSON.stringify(params.extractedData, null, 2) +
            `\n\nLogiciel cible : ${params.targetSoftware}.${colHint}\n` +
            `Génère un mapping JSON de chaque champ source vers la colonne cible la plus probable. ` +
            `Inclus une valeur d'exemple. Ne propose QUE des colonnes de BROUILLON, jamais de validation finale.`,
        },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mappings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sourceField: { type: Type.STRING },
                targetColumn: { type: Type.STRING },
                exampleValue: { type: Type.STRING },
              },
              required: ['sourceField', 'targetColumn', 'exampleValue'],
            },
          },
        },
        required: ['mappings'],
      },
    },
  });

  const text = (response.text ?? '').trim();
  const parsed = JSON.parse(text);
  const tokens = response.usageMetadata?.totalTokenCount ?? 0;
  return { mappings: parsed.mappings ?? [], tokensConsumed: tokens };
}
