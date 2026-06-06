/**
 * Generate a regulatory-compliance PDF for a release's full audit trail.
 *
 * Content:
 *   Cover     — Release name, planned date, final risk level (large badge)
 *   Section 1 — Risk Score Summary (score, level, evaluated_at)
 *   Section 2 — Regulatory Windows Evaluated (table)
 *   Section 3 — Contributing Factors (reasons with points)
 *   Section 4 — Decision Trail (all evaluations chronologically)
 *   Footer    — Retention notice
 */
import PDFDocument from 'pdfkit';
import { format, parseISO } from 'date-fns';

const LEVEL_COLOURS = {
  SAFE:    '#16a34a',
  AT_RISK: '#d97706',
  BLOCKED: '#dc2626',
};

const LEVEL_LABELS = {
  SAFE:    'SAFE',
  AT_RISK: 'AT RISK',
  BLOCKED: 'BLOCKED',
};

const FOOTER_TEXT =
  'Generated for regulatory compliance purposes. Retain for 7 years per FCA requirements.';

/**
 * @param {object}   release   { release_id, name, planned_date, status }
 * @param {object[]} entries   audit_log rows (ordered newest-first from DB, reversed here)
 * @returns {Buffer}           PDF bytes
 */
export async function generateAuditPdf(release, entries) {
  return new Promise((resolve, reject) => {
    const doc  = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const bufs = [];
    doc.on('data', (chunk) => bufs.push(chunk));
    doc.on('end',  () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    const latest  = entries[0] ?? null;
    const W       = doc.page.width  - 100;   // usable width
    const grey    = '#6b7280';
    const darkGrey = '#374151';
    const light   = '#f3f4f6';

    // ── Cover ────────────────────────────────────────────────────────────────
    doc.fontSize(10).fillColor(grey).text('Regulated Release Calendar', 50, 50);
    doc.moveDown(3);

    doc.fontSize(22).fillColor(darkGrey).font('Helvetica-Bold')
       .text(release.name, { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(12).fillColor(grey).font('Helvetica')
       .text(`Planned date: ${fmtDate(release.planned_date)}`, { align: 'center' });
    doc.moveDown(1.5);

    if (latest) {
      const colour = LEVEL_COLOURS[latest.level] ?? '#6b7280';
      const label  = LEVEL_LABELS[latest.level]  ?? latest.level;

      // Large risk level badge
      const badgeW = 180, badgeH = 48;
      const badgeX = (doc.page.width - badgeW) / 2;
      const badgeY = doc.y;
      doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 8).fill(colour);
      doc.fontSize(16).fillColor('white').font('Helvetica-Bold')
         .text(`${label}  (${latest.score})`, badgeX, badgeY + 14, { width: badgeW, align: 'center' });
      doc.y = badgeY + badgeH + 20;
    }

    doc.moveDown(2);
    hRule(doc);

    // ── Section 1: Risk Score Summary ────────────────────────────────────────
    sectionHeading(doc, '1. Risk Score Summary');

    if (latest) {
      kv(doc, 'Score',        String(latest.score));
      kv(doc, 'Level',        LEVEL_LABELS[latest.level] ?? latest.level);
      kv(doc, 'Evaluated at', fmtDateTime(latest.timestamp));
      kv(doc, 'Release date', fmtDate(release.planned_date));
      kv(doc, 'Status',       release.status ?? '—');
    } else {
      doc.fontSize(10).fillColor(grey).text('No risk evaluation recorded.');
    }

    doc.moveDown(1);
    hRule(doc);

    // ── Section 2: Regulatory Windows Evaluated ──────────────────────────────
    sectionHeading(doc, '2. Regulatory Windows Evaluated');

    const windows = latest?.windows_evaluated ?? [];
    if (windows.length === 0) {
      doc.fontSize(10).fillColor(grey).text('No windows were evaluated.');
    } else {
      tableHeader(doc, ['Name', 'Type', 'Start', 'End'], [220, 100, 90, 90]);
      for (const w of windows) {
        tableRow(doc, [
          w.name  ?? '—',
          w.type  ?? '—',
          fmtDate(w.start_date),
          fmtDate(w.end_date),
        ], [220, 100, 90, 90]);
      }
    }

    doc.moveDown(1);
    hRule(doc);

    // ── Section 3: Contributing Factors ──────────────────────────────────────
    sectionHeading(doc, '3. Contributing Factors');

    const reasons = latest?.reasons ?? [];
    if (reasons.length === 0) {
      doc.fontSize(10).fillColor(grey).text('No contributing factors (release scored SAFE).');
    } else {
      tableHeader(doc, ['Window', 'Type', 'Points'], [250, 130, 70]);
      for (const r of reasons) {
        tableRow(doc, [r.window_name ?? '—', r.type ?? '—', `+${r.points}`], [250, 130, 70]);
      }
    }

    doc.moveDown(1);
    hRule(doc);

    // ── Section 4: Decision Trail ─────────────────────────────────────────────
    sectionHeading(doc, '4. Decision Trail');

    const chronological = [...entries].reverse();
    for (const [i, entry] of chronological.entries()) {
      const colour = LEVEL_COLOURS[entry.level] ?? '#6b7280';
      doc.fontSize(9).fillColor(colour).font('Helvetica-Bold')
         .text(`#${i + 1}  ${LEVEL_LABELS[entry.level] ?? entry.level}  (${entry.score})`, { continued: true });
      doc.fillColor(grey).font('Helvetica')
         .text(`   ${fmtDateTime(entry.timestamp)}`);

      if (entry.reasons?.length) {
        for (const r of entry.reasons) {
          doc.fontSize(8).fillColor(darkGrey)
             .text(`  • ${r.window_name ?? r.window_id}  +${r.points} pts`, { indent: 12 });
        }
      }
      doc.moveDown(0.5);
    }

    // ── Footer on every page ─────────────────────────────────────────────────
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7).fillColor(grey)
         .text(FOOTER_TEXT, 50, doc.page.height - 40, { align: 'center', width: W });
    }

    doc.end();
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sectionHeading(doc, text) {
  doc.fontSize(13).fillColor('#111827').font('Helvetica-Bold').text(text);
  doc.moveDown(0.6);
  doc.font('Helvetica');
}

function kv(doc, key, value) {
  doc.fontSize(10).fillColor('#6b7280').text(`${key}:`, { continued: true, width: 150 });
  doc.fillColor('#111827').text(`  ${value}`);
}

function hRule(doc) {
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y)
     .strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.moveDown(0.8);
}

function tableHeader(doc, cols, widths) {
  let x = 50;
  doc.fontSize(9).fillColor('white').font('Helvetica-Bold');
  const rowH = 18;
  doc.rect(50, doc.y, widths.reduce((a, b) => a + b, 0), rowH).fill('#374151');
  const y = doc.y + 4;
  for (let i = 0; i < cols.length; i++) {
    doc.fillColor('white').text(cols[i], x + 4, y, { width: widths[i] - 4, lineBreak: false });
    x += widths[i];
  }
  doc.y += rowH + 2;
  doc.font('Helvetica');
}

function tableRow(doc, cols, widths) {
  let x = 50;
  const rowH = 16;
  const y    = doc.y;
  doc.fontSize(8).fillColor('#111827');
  for (let i = 0; i < cols.length; i++) {
    doc.text(cols[i], x + 4, y + 3, { width: widths[i] - 8, lineBreak: false });
    x += widths[i];
  }
  doc.y = y + rowH;
  // Zebra striping
  doc.rect(50, y, widths.reduce((a, b) => a + b, 0), rowH)
     .strokeColor('#e5e7eb').lineWidth(0.3).stroke();
}

function fmtDate(d) {
  if (!d) return '—';
  try { return format(typeof d === 'string' ? parseISO(d) : new Date(d), 'd MMM yyyy'); }
  catch { return String(d); }
}

function fmtDateTime(d) {
  if (!d) return '—';
  try { return format(typeof d === 'string' ? parseISO(d) : new Date(d), 'd MMM yyyy HH:mm'); }
  catch { return String(d); }
}
