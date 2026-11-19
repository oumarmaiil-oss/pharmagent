// ============================================================
// PharmAgent — Agent IA Vision (Claude)
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type {
  DocumentCategory,
  ExtractedDocumentData,
  GroundingAnalysisResult,
  TargetSoftwareType,
} from '../types/pharmagent.ts';

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY manquante. Ajoutez-la dans les variables d'environnement (Render > Environment).");
  }
  client ??= new Anthropic({ timeout: 120_000 });
  return client;
}

function friendlyError(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new Error('Clé IA invalide ou absente sur le serveur.');
  }
  if (err instanceof Anthropic.RateLimitError || (err instanceof Anthropic.APIError && err.status === 529)) {
    return new Error("Le service d'IA est momentanément surchargé. Réessayez dans une minute.");
  }
  if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
    return new Error('Crédit IA épuisé : rechargez le compte Anthropic.');
  }
  return err instanceof Error ? err : new Error(String(err));
}

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

function documentBlock(mimeType: string, data: string): Anthropic.ContentBlockParam {
  if (mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  return { type: 'image', source: { type: 'base64', media_type: mimeType as ImageType, data } };
}

async function ask<T>(content: Anthropic.ContentBlockParam[], schema: Record<string, unknown>): Promise<{ data: T; tokens: number }> {
  try {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') throw new Error("L'IA a refusé d'analyser ce document.");
    if (res.stop_reason === 'max_tokens') throw new Error('Document trop long pour être lu en une fois.');
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    if (!text) throw new Error("Réponse vide de l'IA.");
    return { data: JSON.parse(text) as T, tokens: res.usage.input_tokens + res.usage.output_tokens };
  } catch (err) {
    throw friendlyError(err);
  }
}

const str = { type: 'string' };
const num = { type: 'number' };

// ─── Extraction de document ───────────────────────────────

export async function extractDocument(params: {
  imageBase64: string;
  mimeType: string;
  documentHint: DocumentCategory;
  taskPrompt?: string;
}): Promise<{ data: ExtractedDocumentData; tokensConsumed: number }> {
  const missionClause = params.taskPrompt?.trim()
    ? `\nInstruction spécifique : "${params.taskPrompt.trim()}". Réponds dans agentObservations.`
    : '';

  const { data, tokens } = await ask<ExtractedDocumentData>(
    [
      documentBlock(params.mimeType, params.imageBase64),
      {
        type: 'text',
        text:
          `Tu es l'agent PharmAgent d'une officine pharmaceutique. ` +
          `Analyse ce document (type probable : ${params.documentHint}). ` +
          `Extrais l'en-tête (numéro, fournisseur/organisme, pharmacie destinataire, date, montant total FCFA) ` +
          `et chaque ligne : désignation recopiée EXACTEMENT comme imprimée (abréviations comprises, ne corrige rien), ` +
          `code CIP/EAN s'il figure sur la ligne, quantité entière, N° lot (lotNumber), ` +
          `date de péremption (expiryDate : colonne « Date Exp. », « Péremption », « DLU » ou « Exp », recopiée telle quelle, ex. 06/2028), ` +
          `prix unitaire d'achat FCFA, prix public/vente FCFA s'il figure. ` +
          `Ne devine jamais un chiffre illisible : baisse la confidence de la ligne.` +
          missionClause,
      },
    ],
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        documentType: str,
        documentNumber: str,
        supplierOrOrg: str,
        recipientPharmacy: str,
        documentDate: str,
        currency: str,
        totalAmountFCFA: num,
        agentObservations: str,
        lineItems: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              designation: str,
              cip: str,
              quantity: { type: 'integer' },
              lotNumber: str,
              expiryDate: str,
              unitPriceFCFA: num,
              salePriceFCFA: num,
              confidence: num,
            },
            required: ['designation', 'quantity', 'unitPriceFCFA', 'confidence'],
          },
        },
      },
      required: ['documentType', 'documentNumber', 'supplierOrOrg', 'recipientPharmacy', 'documentDate', 'totalAmountFCFA', 'lineItems'],
    },
  );

  return { data, tokensConsumed: tokens };
}

// ─── Analyse UI Grounding ─────────────────────────────────

export async function groundTargetInterface(params: {
  imageBase64: string;
  mimeType: string;
  targetSoftware: TargetSoftwareType;
}): Promise<GroundingAnalysisResult> {
  const { data, tokens } = await ask<{ elements: GroundingAnalysisResult['elements']; overallSafe: boolean; observations: string }>(
    [
      documentBlock(params.mimeType, params.imageBase64),
      {
        type: 'text',
        text:
          `Tu es l'agent de sécurité PharmAgent. Analyse cette capture d'écran de l'interface "${params.targetSoftware}". ` +
          `Identifie tous les boutons et champs interactifs. ` +
          `Classe chaque élément : SAFE_DRAFT (brouillon/sauvegarder temporairement), ` +
          `FORBIDDEN_BY_GUARDRAIL (valider/confirmer/soumettre/enregistrer définitivement/clôturer), ` +
          `ou UNKNOWN. ` +
          `La règle absolue : l'agent ne doit JAMAIS cliquer sur un bouton FORBIDDEN.`,
      },
    ],
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        elements: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              elementRole: str,
              detectedLabel: str,
              safetyStatus: str,
              confidence: num,
              suggestedAction: str,
            },
            required: ['elementRole', 'detectedLabel', 'safetyStatus', 'confidence', 'suggestedAction'],
          },
        },
        overallSafe: { type: 'boolean' },
        observations: str,
      },
      required: ['elements', 'overallSafe', 'observations'],
    },
  );

  return {
    targetSoftware: params.targetSoftware,
    elements: data.elements ?? [],
    overallSafe: data.overallSafe ?? false,
    observations: data.observations ?? '',
    tokensConsumed: tokens,
  };
}

// ─── Correspondance produits ambigus (un seul appel par document) ─

export async function resolveProductMatches(params: {
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

  const payload = params.items.map((it) => ({
    index: it.index,
    libelle_grossiste: it.designation,
    prix_achat: it.unitPriceFCFA,
    prix_vente: it.salePriceFCFA,
    candidats: it.candidates.map((c) => ({ id: c.productId, libelle_erp: c.erpLabel })),
  }));

  const { data, tokens } = await ask<{ decisions: Array<{ index: number; productId: string; confidence: number }> }>(
    [{
      type: 'text',
      text:
        `Tu es pharmacien expert en nomenclature. Grossiste : "${params.supplier}".\n` +
        `Pour chaque ligne de bon de livraison, choisis parmi les candidats le produit ERP identique ` +
        `(même molécule ou marque équivalente, même dosage, même forme, même conditionnement). ` +
        `Une marque et son générique NE sont PAS le même produit sauf si le libellé ERP est la même marque. ` +
        `Si aucun candidat n'est identique, renvoie productId vide. confidence entre 0 et 1, sois strict.\n` +
        JSON.stringify(payload),
    }],
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { index: { type: 'integer' }, productId: str, confidence: num },
            required: ['index', 'productId', 'confidence'],
          },
        },
      },
      required: ['decisions'],
    },
  );

  const allowed = new Map(params.items.map((it) => [it.index, new Set(it.candidates.map((c) => c.productId))]));
  // Ne garder que des choix parmi les candidats proposés
  const decisions = (data.decisions ?? []).filter((d) => d.productId && allowed.get(d.index)?.has(d.productId));
  return { decisions, tokensConsumed: tokens };
}
