import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { logoBase64 } from './pdf-logo.mjs';

const A4 = [595.28, 841.89];
const MARGIN = 46;
const COLORS = {
  teal: rgb(0, 133 / 255, 134 / 255),
  dark: rgb(7 / 255, 84 / 255, 89 / 255),
  green: rgb(92 / 255, 188 / 255, 115 / 255),
  yellow: rgb(1, 202 / 255, 5 / 255),
  red: rgb(187 / 255, 31 / 255, 37 / 255),
  ink: rgb(23 / 255, 52 / 255, 59 / 255),
  muted: rgb(75 / 255, 100 / 255, 106 / 255),
  pale: rgb(231 / 255, 242 / 255, 241 / 255),
  line: rgb(213 / 255, 225 / 255, 223 / 255)
};

function printable(value, font) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
  return text.split('\n').map(paragraph => {
    try { font.encodeText(paragraph); return paragraph; }
    catch {
      // Standard PDF fonts cover Portuguese. Substitute unsupported symbols instead of failing the document.
      return [...paragraph].map(char => {
        try { font.encodeText(char); return char; }
        catch { return '?'; }
      }).join('');
    }
  }).join('\n');
}

function wrap(text, font, size, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) { lines.push(line); line = ''; }
      if (font.widthOfTextAtSize(word, size) <= width) { line = word; continue; }
      let part = '';
      for (const character of word) {
        if (part && font.widthOfTextAtSize(part + character, size) > width) {
          lines.push(part);
          part = '';
        }
        part += character;
      }
      line = part;
    }
    if (line) lines.push(line);
  }
  return lines;
}

const fieldLabel = kind => kind === 'incident' ? 'Incidente ou evento adverso' : 'Não conformidade';
const redundantLabels = new Set([
  'data da ocorrência', 'setor', 'setor da ocorrência', 'turno',
  'período da ocorrência', 'tipo de incidente ou evento adverso', 'grau do dano',
  'relato do ocorrido', 'relato do incidente'
]);
const normalized = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Generate a real, multi-page A4 PDF from the stored notification. No browser screenshot or print HTML is used.
 * The caller must check the user's authorization before passing any record here.
 */
export async function notificationPdf(record, issuedAt = new Date()) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(Uint8Array.from(atob(logoBase64), char => char.charCodeAt(0)));
  const width = A4[0] - 2 * MARGIN;
  const issued = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo'
  }).format(issuedAt);
  let page;
  let y;

  function newPage() {
    page = doc.addPage(A4);
    page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: COLORS.teal });
    page.drawImage(logo, { x: MARGIN, y: A4[1] - 129, width: 190, height: 92 });
    page.drawText('NOTIFICAÇÃO INTERNA', { x: 260, y: A4[1] - 68, size: 15, font: bold, color: COLORS.dark });
    page.drawText('AO SETOR', { x: 260, y: A4[1] - 88, size: 15, font: bold, color: COLORS.dark });
    page.drawText('Coordenação de Enfermagem', { x: 260, y: A4[1] - 109, size: 9, font: regular, color: COLORS.muted });
    page.drawLine({ start: { x: MARGIN, y: A4[1] - 144 }, end: { x: A4[0] - MARGIN, y: A4[1] - 144 }, thickness: 1.5, color: COLORS.teal });
    y = A4[1] - 164;
  }
  function ensure(height) {
    if (y - height < 75) newPage();
  }
  function line(text, font = regular, size = 10, color = COLORS.ink, indent = 0, leading = 15) {
    const safe = printable(text, font);
    for (const part of wrap(safe, font, size, width - indent)) {
      ensure(leading);
      if (part) page.drawText(part, { x: MARGIN + indent, y, size, font, color });
      y -= leading;
    }
  }
  function section(title) {
    ensure(30);
    y -= 4;
    page.drawRectangle({ x: MARGIN, y: y - 3, width: 4, height: 18, color: COLORS.green });
    page.drawText(title, { x: MARGIN + 12, y, size: 11, font: bold, color: COLORS.dark });
    y -= 21;
  }
  function field(label, value) {
    if (value === null || value === undefined || String(value).trim() === '') return;
    ensure(33);
    line(label, bold, 9, COLORS.muted, 0, 13);
    line(value, regular, 10, COLORS.ink, 0, 15);
    y -= 5;
  }
  function metaRow(left, right) {
    const columns = [left, right];
    const colWidth = (width - 18) / 2;
    const lines = columns.map(([, value]) => wrap(printable(value, regular), regular, 10, colWidth));
    const height = Math.max(42, 15 + 15 * Math.max(...lines.map(part => part.length)) + 7);
    ensure(height);
    columns.forEach(([label], index) => {
      const x = MARGIN + index * (colWidth + 18);
      page.drawText(label, { x, y, size: 9, font: bold, color: COLORS.muted });
      lines[index].forEach((part, lineIndex) => {
        if (part) page.drawText(part, { x, y: y - 17 - lineIndex * 15, size: 10, font: regular, color: COLORS.ink });
      });
    });
    y -= height;
  }

  doc.setTitle('Notificação interna ' + record.protocol);
  doc.setAuthor('UHP Notifica · Coordenação de Enfermagem');
  doc.setSubject('Notificação ao setor destinatário');
  newPage();
  ensure(62);
  page.drawRectangle({ x: MARGIN, y: y - 52, width, height: 54, color: COLORS.pale, borderColor: COLORS.teal, borderWidth: 0.8 });
  page.drawText('PROTOCOLO', { x: MARGIN + 13, y: y - 15, size: 8, font: bold, color: COLORS.dark });
  page.drawText(printable(record.protocol, bold), { x: MARGIN + 13, y: y - 34, size: 14, font: bold, color: COLORS.ink });
  page.drawText('Emitido em ' + issued, { x: A4[0] - MARGIN - 147, y: y - 35, size: 8, font: regular, color: COLORS.muted });
  y -= 67;

  section('Identificação da ocorrência');
  metaRow(['Setor destinatário', record.sector || 'Não informado'], ['Tipo de notificação', fieldLabel(record.kind)]);
  metaRow(['Data da ocorrência', record.occurredOn?.split('-').reverse().join('/') || 'Não informada'], ['Período', record.period || 'Não informado']);
  if (record.kind === 'incident') {
    metaRow(['Classificação', record.subject || 'Não informada'], ['Grau do dano', record.harm || 'Não informado']);
  }

  section('Relato da ocorrência');
  line(record.description || 'Sem relato.', regular, 10, COLORS.ink);
  y -= 8;

  const extra = (record.entries || []).filter(entry => Array.isArray(entry) && entry.length === 2
    && !redundantLabels.has(normalized(entry[0])) && String(entry[1]).trim());
  if (extra.length) {
    section('Informações complementares');
    for (const [label, value] of extra) field(label, value);
  }

  ensure(130);
  section('Ciência do setor');
  line('Preenchimento após a entrega da via impressa.', regular, 8.5, COLORS.muted);
  y -= 24;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 305, y }, thickness: 0.8, color: COLORS.muted });
  y -= 16;
  line('Nome e assinatura de quem recebeu', regular, 8, COLORS.muted);
  y -= 10;
  line('Data: ____ / ____ / ______', regular, 9, COLORS.ink);

  const pages = doc.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawLine({ start: { x: MARGIN, y: 54 }, end: { x: A4[0] - MARGIN, y: 54 }, thickness: 0.7, color: COLORS.line });
    sheet.drawText('UHP NOTIFICA · Uso interno · ' + printable(record.protocol, regular), {
      x: MARGIN, y: 38, size: 8, font: regular, color: COLORS.muted
    });
    const counter = 'Página ' + (index + 1) + ' de ' + pages.length;
    sheet.drawText(counter, {
      x: A4[0] - MARGIN - regular.widthOfTextAtSize(counter, 8),
      y: 38, size: 8, font: regular, color: COLORS.muted
    });
  });
  return doc.save();
}
