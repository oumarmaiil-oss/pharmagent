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
import { DOCUMENT_READING_RULES, EXTRACTION_GLOSSARY } from './vocabulary.ts';

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';
const EFFORT = (process.env.CLAUDE_EFFORT || 'low') as 'low' | 'medium' | 'high';
/** Seconde lecture, plus attentive, quand la première est incohérente. */
export const SECOND_LOOK_EFFORT = 'medium';

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
  if (mimeType === 'text/plain') {
    return { type: 'document', source: { type: 'text', media_type: 'text/plain', data }, title: 'Fichier du grossiste (tableau)' };
  }
  if (mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  return { type: 'image', source: { type: 'base64', media_type: mimeType as ImageType, data } };
}

// Garde-fou de dépense : nombre maximal d'appels à l'IA par jour, toutes officines confondues
const DAILY_LIMIT = Number(process.env.PHARMAGENT_DAILY_AI_LIMIT) || 300;
let usage = { day: '', count: 0 };
function countAiCall(): void {
  const day = new Date().toISOString().slice(0, 10);
  if (usage.day !== day) usage = { day, count: 0 };
  if (usage.count >= DAILY_LIMIT) throw new Error(`Limite quotidienne d'analyses IA atteinte (${DAILY_LIMIT}). Réessayez demain.`);
  usage.count++;
}

type Effort = 'low' | 'medium' | 'high';

async function ask<T>(content: Anthropic.ContentBlockParam[], schema: Record<string, unknown>, effort: Effort = EFFORT): Promise<{ data: T; tokens: number }> {
  countAiCall();
  try {
    const res = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort, format: { type: 'json_schema', schema } },
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
  effort?: Effort;
  /** Agrandissements (haut, bas) de la même photo, faits par le téléphone, pour les petits caractères. */
  zooms?: Array<{ base64: string; mimeType: string }>;
}): Promise<{ data: ExtractedDocumentData; tokensConsumed: number }> {
  const zooms = (params.zooms ?? []).slice(0, 2);
  const zoomClause = zooms.length
    ? `Les ${zooms.length} images après la première sont des agrandissements (haut puis bas) de la MÊME page, pour lire les petits caractères ` +
      `(lots, péremptions, chiffres). Ce ne sont pas d'autres documents : ne les compte pas dans documentCount et ne duplique aucune ligne. ` +
      `Pour un caractère douteux, l'agrandissement fait foi.\n`
    : '';
  const missionClause = params.taskPrompt?.trim()
    ? `\nInstruction spécifique : "${params.taskPrompt.trim()}". Réponds dans agentObservations.`
    : '';

  const { data, tokens } = await ask<ExtractedDocumentData>(
    [
      documentBlock(params.mimeType, params.imageBase64),
      ...zooms.map((z) => documentBlock(z.mimeType, z.base64)),
      {
        type: 'text',
        text:
          zoomClause +
          `Tu es l'agent PharmAgent d'une officine pharmaceutique. ` +
          `Analyse ce document (type probable : ${params.documentHint}). ` +
          `Extrais l'en-tête (numéro, fournisseur/organisme, pharmacie destinataire, date, montant total FCFA) ` +
          `et chaque ligne : désignation recopiée EXACTEMENT comme imprimée (abréviations comprises, ne corrige rien), ` +
          `code CIP/EAN s'il figure sur la ligne, quantité entière, N° lot (lotNumber), ` +
          `date de péremption (expiryDate : colonne « Date Exp. », « Péremption », « DLU » ou « Exp », recopiée telle quelle, ex. 06/2028), ` +
          `prix unitaire d'achat, prix public/vente s'il figure, UG, remise, TVA et montant de la ligne s'ils figurent. ` +
          `Ne devine jamais un chiffre illisible : baisse la confidence de la ligne (sous 0,6).\n` +
          `Classe d'abord le document (documentType), quel que soit le type probable annoncé : bon_livraison, facture, avoir (retour, quantités négatives), ` +
          `mutuelle (relevé de tiers payant), ordonnance (prescription d'un médecin à un patient : posologie, nom du patient), ` +
          `autre (questionnaire, courrier, ticket, tout le reste). Pour ordonnance et autre, renvoie lineItems vide et n'extrais rien d'autre.\n` +
          `documentCount = nombre de documents distincts visibles sur la photo (numéros différents) ; s'il y en a plusieurs, n'extrais que le premier.\n` +
          `photoQuality : bonne, moyenne, ou illisible si la plupart des chiffres ne se lisent pas (photo floue, trop petite, trop sombre) : ` +
          `dans ce cas ne recopie que ce qui est sûr, sans inventer de lignes.\n` +
          DOCUMENT_READING_RULES + '\n' +
          EXTRACTION_GLOSSARY +
          missionClause,
      },
    ],
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        documentType: { type: 'string', enum: ['bon_livraison', 'facture', 'avoir', 'mutuelle', 'ordonnance', 'autre'] },
        documentCount: { type: 'integer' },
        photoQuality: { type: 'string', enum: ['bonne', 'moyenne', 'illisible'] },
        documentNumber: str,
        supplierOrOrg: str,
        recipientPharmacy: str,
        documentDate: str,
        currency: str,
        totalAmountFCFA: num,
        totalHT: num,
        totalTVA: num,
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
              freeUnits: { type: 'integer' },
              discountPercent: num,
              vatRate: num,
              lineTotal: num,
              confidence: num,
            },
            required: ['designation', 'quantity', 'unitPriceFCFA', 'confidence'],
          },
        },
      },
      required: ['documentType', 'documentCount', 'photoQuality', 'documentNumber', 'supplierOrOrg', 'recipientPharmacy', 'documentDate', 'totalAmountFCFA', 'lineItems'],
    },
    params.effort,
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

// ─── Remplissage universel d'un tableau ───────────────────

export async function fillTableFromDocument(params: {
  document: { base64: string; mimeType: string };
  columns: string[];
  fields: string[];
}): Promise<{ rows: string[][]; fields: Record<string, string>; tokensConsumed: number }> {
  const cols = params.columns.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const { data, tokens } = await ask<{ rows: Array<{ values: string[] }>; fields: Array<{ label: string; value: string }> }>(
    [
      documentBlock(params.document.mimeType, params.document.base64),
      {
        type: 'text',
        text:
          `Tu remplis un tableau Excel à partir de ce document. Colonnes du tableau, dans l'ordre :\n${cols}\n` +
          (params.fields.length ? `Champs d'en-tête à remplir : ${params.fields.join(' ; ')}.\n` : '') +
          `Renvoie une ligne par élément du document qui correspond au tableau (une personne, un patient, un produit…), ` +
          `avec exactement ${params.columns.length} valeurs dans l'ordre des colonnes. Recopie les valeurs telles qu'écrites ; ` +
          `dates au format JJ/MM/AAAA ; nombres sans séparateur de milliers. Laisse une valeur vide ("") si le document ne la donne pas : ` +
          `n'invente jamais rien. Quand plusieurs informations du document conviennent pour une colonne, prends la plus complète ` +
          `(ex. pour une désignation : le libellé du produit, pas une case vide ou un statut). ` +
          `Pour les champs d'en-tête, renvoie le libellé exactement comme fourni. ` +
          `Si le document n'a aucun rapport avec le tableau, renvoie rows vide. Remplis tous les champs d'en-tête que le document donne.\n` +
          `Si c'est un bon de livraison ou une facture de pharmacie, applique aussi ces règles :\n` + DOCUMENT_READING_RULES + '\n' + EXTRACTION_GLOSSARY,
      },
    ],
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        rows: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { values: { type: 'array', items: str } }, required: ['values'] } },
        fields: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { label: str, value: str }, required: ['label', 'value'] } },
      },
      required: ['rows', 'fields'],
    },
  );
  return {
    rows: (data.rows ?? []).slice(0, 500).map((r) => (r.values ?? []).slice(0, params.columns.length)),
    fields: Object.fromEntries((data.fields ?? []).map((f) => [f.label, f.value])),
    tokensConsumed: tokens,
  };
}

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
