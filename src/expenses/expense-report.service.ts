import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { UsageService } from '../analytics/usage.service.js';
import { type GroupMember, UsageMetric } from '../database/entities/index.js';
import { formatDate, text } from '../itinerary/itinerary-pdf.service.js';
import { categoryLabel, ExpensesService, money } from './expenses.service.js';

type ReportData = Awaited<ReturnType<ExpensesService['reportData']>>;

const LEFT = 50;
const CONTENT_WIDTH = 495; // A4 width 595pt minus 50pt margins
const PAGE_BOTTOM = 842 - 60; // A4 height minus bottom margin

/**
 * Exportable expense report (PDF §2.7 "for offline record"): a PDF to read and share, or a CSV
 * for spreadsheets / company reimbursement (PDF §10.2). Built on request from the same data as
 * the summary, so the two always agree.
 */
@Injectable()
export class ExpenseReportService {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly usage: UsageService,
  ) {}

  async export(groupId: string, actor: GroupMember, format: 'pdf' | 'csv') {
    const data = await this.expenses.reportData(groupId, actor);
    this.usage.record(UsageMetric.EXPENSE_REPORT_EXPORTED, actor.userId, groupId);
    const base = `${slug(data.group.name)}-expenses-${new Date().toLocaleDateString('en-CA')}`;
    return format === 'csv'
      ? { file: Buffer.from(this.csv(data), 'utf8'), filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8' }
      : { file: await this.pdf(data), filename: `${base}.pdf`, contentType: 'application/pdf' };
  }

  /** One row per expense and per repayment. Starts with a BOM so Excel reads UTF-8 (₹, names). */
  private csv({ expenses, settlements }: ReportData): string {
    const rows: (string | number)[][] = [
      ['Type', 'Date', 'Category', 'Description', 'Paid by', 'Amount', 'Currency', 'Split', 'Shares', 'Notes'],
    ];
    for (const e of expenses) {
      rows.push([
        'EXPENSE',
        e.date,
        e.category,
        e.description ?? '',
        e.payments.length > 1 ? e.payments.map((p) => `${p.name}: ${p.amount.toFixed(2)}`).join('; ') : e.paidBy.name,
        e.amount.toFixed(2),
        e.currency,
        e.splitType,
        e.splits.map((s) => `${s.name}: ${s.amount.toFixed(2)}`).join('; '),
        e.notes ?? '',
      ]);
    }
    for (const s of settlements) {
      rows.push(['REPAYMENT', s.date, '', s.note ?? '', s.from.name, s.amount.toFixed(2), s.currency, '', `To ${s.to.name}`]);
    }
    return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  private pdf({ group, summary, expenses, settlements }: ReportData): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${text(group.name)} - Expenses`, Author: 'TravelGo' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    const cur = summary.currency;

    doc.font('Helvetica-Bold').fontSize(22).text(`${text(group.name)}: expenses`);
    doc.moveDown(0.3).font('Helvetica').fontSize(11).fillColor('#444');
    doc.text(`Trip dates: ${formatDate(group.tripStart)} – ${formatDate(group.tripEnd)}`);
    doc.text(`Total spent: ${money(summary.totalSpent, cur)} across ${summary.expenseCount} expense(s)`);

    // Who owes whom
    heading(doc, 'Settle up');
    if (!summary.settleUp.length) line(doc, 'Everyone is settled up.');
    for (const t of summary.settleUp) line(doc, `${text(t.from.name)} pays ${text(t.to.name)}: ${money(t.amount, cur)}`);

    heading(doc, 'Balances');
    table(doc, 1, [170, 80, 80, 80, 85], ['Member', 'Paid', 'Share', 'Repaid (net)', 'Balance'], summary.members.map((m) => [
      text(m.name) + (m.isMember ? '' : ' (left)'),
      fmt(m.paid),
      fmt(m.share),
      fmt(m.repaid - m.received),
      fmt(m.balance),
    ]));
    small(doc, 'Balance > 0: is owed money. Balance < 0: owes money.');

    heading(doc, 'By category');
    table(doc, 1, [245, 80, 80, 90], ['Category', 'Expenses', 'Share', 'Total'], summary.byCategory.map((c) => [
      categoryLabel(c.category),
      String(c.count),
      `${c.percent}%`,
      fmt(c.total),
    ]));

    heading(doc, `Expenses (${expenses.length})`);
    table(doc, 4, [70, 80, 175, 90, 80], ['Date', 'Category', 'Description', 'Paid by', 'Amount'], expenses.map((e) => [
      e.date,
      categoryLabel(e.category),
      `${e.description ? `${text(e.description)} ` : ''}[${e.splits.length === 1 ? text(e.splits[0].name) : `${e.splits.length} people, ${e.splitType.toLowerCase()}`}]`,
      text(e.paidBy.name) + (e.payments.length > 1 ? ` +${e.payments.length - 1}` : ''),
      fmt(e.amount),
    ]));

    if (settlements.length) {
      heading(doc, `Repayments (${settlements.length})`);
      table(doc, 4, [70, 130, 130, 85, 80], ['Date', 'From', 'To', 'Note', 'Amount'], settlements.map((s) => [
        s.date,
        text(s.from.name),
        text(s.to.name),
        text(s.note ?? ''),
        fmt(s.amount),
      ]));
    }

    doc.moveDown(2).font('Helvetica').fontSize(9).fillColor('#888');
    doc.text(`All amounts in ${cur}. Generated by TravelGo on ${formatDate(new Date())}`, LEFT, doc.y, { width: CONTENT_WIDTH, align: 'center' });
    doc.end();
    return done;
  }
}

function heading(doc: PDFKit.PDFDocument, title: string): void {
  if (doc.y > PAGE_BOTTOM - 60) doc.addPage();
  doc.moveDown(1).font('Helvetica-Bold').fontSize(14).fillColor('#000').text(title, LEFT, doc.y);
  doc.moveDown(0.3);
}

function line(doc: PDFKit.PDFDocument, value: string): void {
  doc.font('Helvetica').fontSize(11).fillColor('#000').text(value, LEFT, doc.y);
}

function small(doc: PDFKit.PDFDocument, value: string): void {
  doc.moveDown(0.3).font('Helvetica').fontSize(9).fillColor('#666').text(value, LEFT, doc.y);
}

/** Simple table: bold header, then rows. Columns from `numericFrom` on are right-aligned (numbers). */
function table(doc: PDFKit.PDFDocument, numericFrom: number, widths: number[], header: string[], rows: string[][]): void {
  const draw = (cells: string[], bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000');
    const height = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: widths[i] - 6 }))) + 6;
    if (doc.y + height > PAGE_BOTTOM) doc.addPage();
    const top = doc.y;
    let x = LEFT;
    cells.forEach((cell, i) => {
      doc.text(cell, x, top + 3, { width: widths[i] - 6, align: i >= numericFrom ? 'right' : 'left' });
      x += widths[i];
    });
    doc.y = top + height;
    doc.moveTo(LEFT, doc.y).lineTo(LEFT + CONTENT_WIDTH, doc.y).lineWidth(0.5).strokeColor(bold ? '#999' : '#ddd').stroke();
  };
  draw(header, true);
  if (!rows.length) draw(['None yet', ...header.slice(1).map(() => '')], false);
  for (const row of rows) draw(row, false);
}

function fmt(amount: number): string {
  return amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Quotes a CSV cell and defuses formula injection (=, +, -, @ at the start run in Excel). */
function csvCell(value: string | number): string {
  let cell = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) || cell !== cell.trim() ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trip';
}
