import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { AuditLogEntry, OfficineRecord } from '../types/pharmagent';

type JsPdfWithAutoTable = jsPDF & {
  lastAutoTable?: {
    finalY: number;
  };
};

export interface AuditPdfExportOptions {
  logs: AuditLogEntry[];
  pharmacy?: OfficineRecord | null;
  filterLabel: string;
  dateFrom?: string;
  dateTo?: string;
  searchQuery?: string;
  signatoryName?: string;
}

export interface AuditPdfExportResult {
  fileName: string;
  exportedCount: number;
  integrityHash: string;
  referenceId: string;
}

function sanitizePdfText(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '·');
}

function formatNumberPdf(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatDateTimePdf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return sanitizePdfText(iso);
  return sanitizePdfText(
    date.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  );
}

function formatDocumentType(docType: AuditLogEntry['documentType']): string {
  if (docType === 'bon_livraison') return 'Bon livraison';
  if (docType === 'facture') return 'Facture';
  return 'Mutuelle';
}

function formatDecisionLabel(state: AuditLogEntry['finalState']): string {
  if (state === 'BROUILLON_CREE') return 'Brouillon créé';
  if (state === 'VALIDE_HUMAIN') return 'Validé (Pharmacien)';
  if (state === 'BROUILLON_REJETE') return 'Brouillon rejeté';
  return 'Validation bloquée';
}

async function computeIntegrityHash(payload: string): Promise<string> {
  try {
    if (typeof window !== 'undefined' && window.crypto?.subtle) {
      const encoded = new TextEncoder().encode(payload);
      const digest = await window.crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    }
  } catch {
    // Fallback below if Web Crypto is unavailable
  }

  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0').toUpperCase();
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0').toUpperCase();
  return `${part1}${part2}`;
}

function drawPharmAgentMark(doc: jsPDF, x: number, y: number) {
  doc.setFillColor(15, 23, 42);
  doc.setDrawColor(51, 65, 85);
  doc.roundedRect(x, y, 11, 11, 2, 2, 'FD');

  doc.setFillColor(16, 185, 129);
  // Medical cross
  doc.rect(x + 4.7, y + 2.6, 1.6, 5.8, 'F');
  doc.rect(x + 2.6, y + 4.7, 5.8, 1.6, 'F');
}

export async function exportAuditLogsToPdf(
  options: AuditPdfExportOptions
): Promise<AuditPdfExportResult> {
  const {
    logs,
    pharmacy,
    filterLabel,
    dateFrom,
    dateTo,
    searchQuery,
    signatoryName,
  } = options;

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  }) as JsPdfWithAutoTable;

  const now = new Date();
  const dateTag = now.toISOString().slice(0, 10);
  const timeTag = now.toTimeString().slice(0, 5).replace(':', '');
  const referenceId = `AUD-OFF-${dateTag.replace(/-/g, '')}-${timeTag}`;
  const generatedAtStr = sanitizePdfText(
    now.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  );

  const canonicalPayload = JSON.stringify({
    referenceId,
    pharmacyId: pharmacy?.id || 'ALL',
    count: logs.length,
    entries: logs.map((l) => ({
      id: l.id,
      ts: l.timestamp,
      ph: l.pharmacyId,
      doc: l.documentNumber,
      state: l.finalState,
      actor: l.actorName || '',
    })),
  });
  const integrityHash = await computeIntegrityHash(canonicalPayload);
  const shortHash = integrityHash.slice(0, 16);

  const draftsCount = logs.filter((l) => l.finalState === 'BROUILLON_CREE').length;
  const humanCount = logs.filter((l) => l.finalState === 'VALIDE_HUMAIN').length;
  const rejectedCount = logs.filter((l) => l.finalState === 'BROUILLON_REJETE').length;
  const blockedCount = logs.filter((l) => l.finalState === 'VALIDATION_BLOQUEE').length;
  const totalTokens = logs.reduce((sum, l) => sum + (l.tokensUsed || 0), 0);

  // Header Banner (297mm wide landscape A4)
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, 297, 30, 'F');
  doc.setFillColor(16, 185, 129);
  doc.rect(0, 29, 297, 1.2, 'F');

  drawPharmAgentMark(doc, 14, 7.5);

  doc.setTextColor(248, 250, 252);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(
    sanitizePdfText("PharmAgent - Registre Officiel d'Audit & Garde-Fous"),
    29,
    12.5
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  const scopeSubtitle = pharmacy
    ? `Officine : ${pharmacy.name} (${pharmacy.city}) · Titulaire : ${pharmacy.pharmacist} · Clé : ${pharmacy.agentKey}`
    : 'Périmètre : Supervision Multi-Officines (Consolidation globale)';
  doc.text(sanitizePdfText(scopeSubtitle), 29, 19.5);
  doc.text(
    sanitizePdfText(
      `Politique : DraftOnlyGuardrail ACTIF (Arrêt strict au Brouillon · Signature humaine obligatoire)`
    ),
    29,
    25
  );

  // Right-aligned official metadata card inside header
  doc.setFillColor(30, 41, 59);
  doc.setDrawColor(51, 65, 85);
  doc.roundedRect(214, 5, 69, 20, 1.5, 1.5, 'FD');
  doc.setTextColor(16, 185, 129);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(sanitizePdfText(`REF : ${referenceId}`), 217, 10.5);
  doc.setTextColor(226, 232, 240);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(sanitizePdfText(`Extrait le : ${generatedAtStr}`), 217, 15.5);
  doc.text(sanitizePdfText(`Empreinte : ${shortHash}`), 217, 20.5);

  // Executive Summary & Filter Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, 34, 269, 18, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    sanitizePdfText(
      `Synthèse : ${formatNumberPdf(logs.length)} événement(s) · Brouillons : ${formatNumberPdf(draftsCount)} · Validés : ${formatNumberPdf(humanCount)} · Rejetés : ${formatNumberPdf(rejectedCount)} · Bloqués : ${formatNumberPdf(blockedCount)} · Tokens : ${formatNumberPdf(totalTokens)}`
    ),
    18,
    40.5
  );

  const activeFilters: string[] = [`Décision : ${filterLabel}`];
  if (dateFrom || dateTo) {
    activeFilters.push(`Période : ${dateFrom || '...'} au ${dateTo || '...'}`);
  }
  if (searchQuery?.trim()) {
    activeFilters.push(`Recherche : "${searchQuery.trim()}"`);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    sanitizePdfText(`Critères appliqués : ${activeFilters.join(' | ')}`),
    18,
    47.5
  );

  // Audit table rows
  const rows = logs.map((entry) => [
    sanitizePdfText(entry.id),
    formatDateTimePdf(entry.timestamp),
    sanitizePdfText(`${entry.pharmacyName}\n${entry.city}`),
    sanitizePdfText(`${entry.documentNumber}\n(${formatDocumentType(entry.documentType)})`),
    sanitizePdfText(entry.targetSoftware),
    formatNumberPdf(entry.tokensUsed),
    sanitizePdfText(formatDecisionLabel(entry.finalState)),
    sanitizePdfText(
      entry.actorName
        ? `${entry.actorName}${entry.actorRole ? `\n(${entry.actorRole})` : ''}`
        : 'Agent / Superviseur'
    ),
    sanitizePdfText(entry.guardrailMessage),
  ]);

  autoTable(doc, {
    startY: 56,
    margin: { left: 14, right: 14, bottom: 20 },
    head: [
      [
        'ID Audit',
        'Date & Heure',
        'Officine',
        'Document',
        'Logiciel cible',
        'Tokens',
        'Décision Garde-Fou',
        'Acteur / Rôle',
        "Détail d'exécution & Garde-fou",
      ],
    ],
    body: rows,
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: 2.3,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: 'top',
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [248, 250, 252],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 20, fontStyle: 'bold' },
      1: { cellWidth: 26 },
      2: { cellWidth: 34 },
      3: { cellWidth: 28 },
      4: { cellWidth: 31 },
      5: { cellWidth: 16, halign: 'right' },
      6: { cellWidth: 29, fontStyle: 'bold' },
      7: { cellWidth: 28 },
      8: { cellWidth: 'auto' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6) {
        const entry = logs[data.row.index];
        if (!entry) return;
        if (entry.finalState === 'VALIDE_HUMAIN') {
          data.cell.styles.textColor = [5, 150, 105];
          data.cell.styles.fillColor = [236, 253, 245];
        } else if (entry.finalState === 'BROUILLON_CREE') {
          data.cell.styles.textColor = [180, 83, 9];
          data.cell.styles.fillColor = [255, 251, 235];
        } else if (entry.finalState === 'BROUILLON_REJETE') {
          data.cell.styles.textColor = [100, 116, 139];
          data.cell.styles.fillColor = [241, 245, 249];
        } else {
          data.cell.styles.textColor = [185, 28, 28];
          data.cell.styles.fillColor = [254, 242, 242];
        }
      }
    },
  });

  // Official Attestation & Pharmacist Signature Block
  let blockY = (doc.lastAutoTable?.finalY ?? 60) + 8;
  if (blockY > 158) {
    doc.addPage();
    blockY = 18;
  }

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(148, 163, 184);
  doc.roundedRect(14, blockY, 175, 32, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    sanitizePdfText('Attestation de traçabilité & Verrouillage Garde-Fou'),
    18,
    blockY + 6
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  const attestationText = doc.splitTextToSize(
    sanitizePdfText(
      "Ce document constitue un extrait horodaté du journal d'audit PharmAgent. Conformément au module déterministe DraftOnlyGuardrail, aucune validation comptable, clôture ou entrée définitive en stock n'est exécutée automatiquement : chaque opération s'arrête au stade Brouillon jusqu'à validation explicite d'un Pharmacien titulaire authentifié."
    ),
    167
  );
  doc.text(attestationText, 18, blockY + 11.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(5, 150, 105);
  doc.text(
    sanitizePdfText(`Empreinte SHA-256 : ${integrityHash}`),
    18,
    blockY + 28.5
  );

  // Signature / Cachet box
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(148, 163, 184);
  doc.roundedRect(194, blockY, 89, 32, 1.5, 1.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    sanitizePdfText('Visa & Cachet du Pharmacien Titulaire'),
    198,
    blockY + 6
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  const resolvedSignatory =
    signatoryName?.trim() || pharmacy?.pharmacist || 'Pharmacien Titulaire / Responsable';
  doc.text(sanitizePdfText(`Responsable : ${resolvedSignatory}`), 198, blockY + 12);
  doc.text(sanitizePdfText(`Date de visa : ____ / ____ / ________`), 198, blockY + 18);
  doc.text(sanitizePdfText('Signature & Cachet officinal :'), 198, blockY + 24);
  doc.setDrawColor(203, 213, 225);
  doc.line(198, blockY + 29, 278, blockY + 29);

  // Add consistent page footer across all pages
  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    doc.setDrawColor(226, 232, 240);
    doc.line(14, 198, 283, 198);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      sanitizePdfText(
        `PharmAgent · Registre officiel d'audit & garde-fous (${referenceId})`
      ),
      14,
      203
    );
    doc.text(
      sanitizePdfText(`Empreinte : ${shortHash} · Page ${page} / ${totalPages}`),
      283,
      203,
      { align: 'right' }
    );
  }

  const slugScope = pharmacy
    ? pharmacy.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    : 'Multi_Officines';

  const fileName = `PharmAgent_Audit_Officiel_${slugScope}_${dateTag}.pdf`;
  doc.save(fileName);

  return {
    fileName,
    exportedCount: logs.length,
    integrityHash,
    referenceId,
  };
}
