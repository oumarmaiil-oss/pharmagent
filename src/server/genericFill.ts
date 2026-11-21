// ============================================================
// PharmAgent — Remplissage universel : n'importe quel tableau Excel rempli par l'IA à partir de n'importe quel document
// (registre mutuelle, formulaire de recueil, tableau maison…). Le fichier est rendu pour vérification, rien n'est saisi.
// ============================================================

import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { matchHeaderLabel } from './vocabulary.ts';

export interface TemplateShape {
  sheet: string;
  headerRow: number;
  columns: Array<{ col: number; label: string }>;
  /** Intitulés au-dessus du tableau (« Pharmacie : », « Date : ») avec la case où écrire la valeur. */
  fields: Array<{ label: string; row: number; col: number }>;
}

const textOf = (c: ExcelJS.Cell): string => { try { return String(c.text ?? '').trim(); } catch { return ''; } };
const hasFormula = (c: ExcelJS.Cell) => { try { return !!c.formula || !!(c.value as { sharedFormula?: string } | null)?.sharedFormula; } catch { return false; } };
const isEmpty = (c: ExcelJS.Cell) => !hasFormula(c) && textOf(c) === '';
// Cellule secondaire d'une fusion (même texte que la principale) : ignorée
const isMergedSlave = (c: ExcelJS.Cell) => { try { return c.isMerged && c.master.address !== c.address; } catch { return false; } };
const isLabel = (s: string) => s.length >= 2 && s.length <= 60 && /[A-Za-zÀ-ÿ]/.test(s) && !/^\d+([.,]\d+)?$/.test(s);

/** Fichier (xlsx, xls, ods, numbers, csv) → classeur ExcelJS modifiable. */
export async function loadTemplate(buf: Buffer): Promise<{ wb: ExcelJS.Workbook; converted: boolean }> {
  const isXlsx = buf[0] === 0x50 && buf[1] === 0x4b && buf.includes('xl/workbook');
  const wb = new ExcelJS.Workbook();
  if (isXlsx) {
    try { await wb.xlsx.load(buf as unknown as ExcelJS.Buffer); return { wb, converted: false }; } catch { /* converti ci-dessous */ }
  }
  const text = !(buf[0] === 0x50 && buf[1] === 0x4b) && !(buf[0] === 0xd0 && buf[1] === 0xcf);
  const sheet = text ? XLSX.read(buf.toString('utf-8').replace(/^﻿/, ''), { type: 'string', raw: true }) : XLSX.read(buf, { type: 'buffer' });
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(XLSX.write(sheet, { type: 'buffer', bookType: 'xlsx' }) as unknown as ExcelJS.Buffer);
  return { wb: out, converted: true };
}

/** Repère le tableau à remplir : la ligne d'intitulés la plus fournie, suivie de lignes vides (ou numérotées) à remplir. */
export function templateShape(wb: ExcelJS.Workbook): TemplateShape | undefined {
  let best: (TemplateShape & { score: number }) | undefined;
  for (const ws of wb.worksheets) {
    if (/^r[ée]sum[ée] de l.exportation$/i.test(ws.name)) continue;   // page de garde ajoutée par Numbers
    for (let r = 1; r <= Math.min(ws.rowCount, 40); r++) {
      const columns: TemplateShape['columns'] = [];
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
        const t = textOf(cell);
        if (isLabel(t) && !t.endsWith(':') && !isMergedSlave(cell)) columns.push({ col, label: t });
      });
      if (columns.length < 3) continue;
      // Les lignes déjà remplies sont gardées : les nouvelles s'ajoutent à la suite
      const score = columns.length * 10 - r * 0.1;
      if (!best || score > best.score) {
        const fields: TemplateShape['fields'] = [];
        for (let fr = 1; fr < r; fr++) {
          ws.getRow(fr).eachCell({ includeEmpty: false }, (cell, col) => {
            const t = textOf(cell);
            if ((!t.endsWith(':') && !matchHeaderLabel(t)) || t.length > 60 || isMergedSlave(cell)) return;
            const right = ws.getRow(fr).getCell(col + 1);
            if (isEmpty(right)) fields.push({ label: t.replace(/\s*:\s*$/, ''), row: fr, col: col + 1 });
          });
        }
        best = { sheet: ws.name, headerRow: r, columns, fields, score };
      }
    }
  }
  if (!best) return undefined;
  const { score: _s, ...shape } = best;
  return shape;
}

const looksNumber = (s: string) => /^-?\d+([.,]\d+)?$/.test(s.replace(/\s/g, ''));

/** Écrit les lignes renvoyées par l'IA à partir de la première ligne libre, sans écraser les formules ni les numéros de ligne. */
export function writeRows(wb: ExcelJS.Workbook, shape: TemplateShape, rows: string[][], fields: Record<string, string>): { linesWritten: number; fieldsFilled: string[] } {
  const ws = wb.getWorksheet(shape.sheet)!;
  // Colonne « N° » pré-numérotée : ignorée pour décider si une ligne est libre
  const dataCols = shape.columns.filter((c) => !/^(n|no|n°|#|num|numero|ligne)$/i.test(c.label.replace(/[.\s]/g, '')));
  const blank = (c: ExcelJS.Cell) => hasFormula(c) || textOf(c) === '';
  const isTotal = (r: number) => { try { return /^\s*(totaux?|total g[ée]n[ée]ral|sous[- ]total|net [àa] payer)\b/i.test(textOf(ws.getRow(r).getCell(shape.columns[0].col)) || textOf(ws.getRow(r).getCell(1))); } catch { return false; } };
  const free = (r: number) => !isTotal(r) && dataCols.every((c) => blank(ws.getRow(r).getCell(c.col)));
  let target = shape.headerRow + 1;
  while (target <= ws.rowCount + 1 && !free(target) && !isTotal(target)) target++;
  let written = 0;
  for (const values of rows) {
    if (!values.some((v) => String(v ?? '').trim())) continue;
    if (!free(target)) ws.insertRow(target, [], 'i');
    const row = ws.getRow(target);
    shape.columns.forEach((c, i) => {
      const v = String(values[i] ?? '').trim();
      const cell = row.getCell(c.col);
      if (!v || hasFormula(cell) || !dataCols.includes(c)) return;
      cell.value = looksNumber(v) ? Number(v.replace(/\s/g, '').replace(',', '.')) : v;
    });
    row.commit();
    target++; written++;
  }
  const fieldsFilled: string[] = [];
  for (const f of shape.fields) {
    const v = String(fields[f.label] ?? '').trim();
    if (!v) continue;
    ws.getRow(f.row).getCell(f.col).value = v;
    fieldsFilled.push(f.label);
  }
  return { linesWritten: written, fieldsFilled };
}
