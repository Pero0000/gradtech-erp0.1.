export type ColKind = 'text' | 'eur' | 'num' | 'date';

export interface ExportColumn<T> {
  header: string;
  get: (row: T) => string | number | null | undefined;
  kind?: ColKind;
  width?: number;
}

export interface ExportSpec<T> {
  /** Naziv datoteke bez ekstenzije */
  file: string;
  title: string;
  subtitle?: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Redak zbroja: vrijednosti po zaglavlju stupca */
  totals?: Record<string, number | string>;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const eurFmt = (v: number) => v.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const numFmt = (v: number) => v.toLocaleString('hr-HR', { maximumFractionDigits: 2 });
const dateFmt = (v: string) => {
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('hr-HR');
};

function display(v: string | number | null | undefined, kind: ColKind = 'text'): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return kind === 'eur' ? eurFmt(v) : numFmt(v);
  return kind === 'date' ? dateFmt(v) : v;
}

const stamp = () => new Date().toISOString().slice(0, 10);
const safeName = (s: string) => s.replace(/[^\p{L}\p{N}_-]+/gu, '_');

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportExcel<T>(spec: ExportSpec<T>) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(spec.title.slice(0, 30).replace(/[\\/?*[\]:]/g, ' '));
  const n = spec.columns.length;

  ws.addRow([spec.title]).font = { bold: true, size: 14 };
  ws.addRow([spec.subtitle ?? `Izvezeno ${new Date().toLocaleDateString('hr-HR')}`]).font = { color: { argb: 'FF64748B' } };
  ws.addRow([]);
  const head = ws.addRow(spec.columns.map((c) => c.header));
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    c.alignment = { vertical: 'middle' };
  });

  spec.rows.forEach((r) => {
    const row = ws.addRow(spec.columns.map((c) => {
      const v = c.get(r);
      if (v === null || v === undefined || v === '') return null;
      if (c.kind === 'date' && typeof v === 'string') {
        const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
        return Number.isNaN(d.getTime()) ? v : d;
      }
      return v;
    }));
    spec.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.kind === 'eur') cell.numFmt = '#,##0.00 "€"';
      else if (c.kind === 'num') cell.numFmt = '#,##0.##';
      else if (c.kind === 'date') cell.numFmt = 'dd.mm.yyyy.';
    });
  });

  if (spec.totals) {
    const t = ws.addRow(spec.columns.map((c, i) => (i === 0 && !(c.header in spec.totals!) ? 'Ukupno' : spec.totals![c.header] ?? null)));
    t.font = { bold: true };
    spec.columns.forEach((c, i) => {
      if (c.kind === 'eur') t.getCell(i + 1).numFmt = '#,##0.00 "€"';
      else if (c.kind === 'num') t.getCell(i + 1).numFmt = '#,##0.##';
    });
    t.eachCell({ includeEmpty: true }, (c) => { c.border = { top: { style: 'thin' } }; });
  }

  spec.columns.forEach((c, i) => {
    const longest = Math.max(c.header.length, ...spec.rows.slice(0, 200).map((r) => display(c.get(r), c.kind).length));
    ws.getColumn(i + 1).width = c.width ?? Math.min(60, Math.max(10, longest + 2));
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: n } };

  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeName(spec.file)}_${stamp()}.xlsx`);
}

// PDF se crta kao slika HTML tablice kako bi hrvatski znakovi (č, ć, š, ž, đ) bili ispravni
export async function exportPdf<T>(spec: ExportSpec<T>) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const ROWS_PER_PAGE = 24;
  const PAGE_W = 297;
  const PAGE_H = 210;
  const M = 8;

  const right = (k?: ColKind) => k === 'eur' || k === 'num';
  const head = `<tr>${spec.columns.map((c) => `<th class="${right(c.kind) ? 'r' : ''}">${esc(c.header)}</th>`).join('')}</tr>`;
  const bodyRows = spec.rows.map((r, i) => `<tr class="${i % 2 ? 'z' : ''}">${spec.columns.map((c) => `<td class="${right(c.kind) ? 'r' : ''}">${esc(display(c.get(r), c.kind))}</td>`).join('')}</tr>`);
  const totalRow = spec.totals
    ? `<tr class="t">${spec.columns.map((c, i) => {
        const v = spec.totals![c.header];
        const text = v === undefined ? (i === 0 ? 'Ukupno' : '') : typeof v === 'number' ? display(v, c.kind) : v;
        return `<td class="${right(c.kind) ? 'r' : ''}">${esc(text)}</td>`;
      }).join('')}</tr>`
    : '';

  const chunks: string[][] = [];
  for (let i = 0; i < bodyRows.length; i += ROWS_PER_PAGE) chunks.push(bodyRows.slice(i, i + ROWS_PER_PAGE));
  if (chunks.length === 0) chunks.push([]);
  if (totalRow) {
    const last = chunks[chunks.length - 1];
    if (last.length >= ROWS_PER_PAGE) chunks.push([totalRow]);
    else last.push(totalRow);
  }

  const style = `<style>
    .pg{width:1120px;padding:20px 24px;background:#fff;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a}
    .pg h1{margin:0;font-size:20px}.pg .sub{margin:2px 0 12px;font-size:11px;color:#64748b}
    .pg table{width:100%;border-collapse:collapse;font-size:11px}
    .pg th{background:#1e293b;color:#fff;text-align:left;padding:6px 8px;font-weight:600}
    .pg td{padding:5px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top}
    .pg .z td{background:#f8fafc}.pg .r{text-align:right;white-space:nowrap}
    .pg .t td{font-weight:700;background:#e2e8f0;border-top:2px solid #94a3b8}
    .pg .foot{margin-top:8px;font-size:10px;color:#94a3b8;display:flex;justify-content:space-between}
  </style>`;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;';
  document.body.appendChild(host);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const subtitle = spec.subtitle ?? `Izvezeno ${new Date().toLocaleDateString('hr-HR')}`;

  try {
    await document.fonts?.ready;
    for (let i = 0; i < chunks.length; i++) {
      host.innerHTML = `${style}<div class="pg"><h1>${esc(spec.title)}</h1><div class="sub">${esc(subtitle)}</div><table><thead>${head}</thead><tbody>${chunks[i].join('')}</tbody></table><div class="foot"><span>TM Color</span><span>Stranica ${i + 1} / ${chunks.length}</span></div></div>`;
      const el = host.querySelector('.pg') as HTMLElement;
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff' });
      let w = PAGE_W - M * 2;
      let h = (canvas.height / canvas.width) * w;
      if (h > PAGE_H - M * 2) {
        h = PAGE_H - M * 2;
        w = (canvas.width / canvas.height) * h;
      }
      if (i > 0) doc.addPage();
      doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', M, M, w, h);
    }
    doc.save(`${safeName(spec.file)}_${stamp()}.pdf`);
  } finally {
    document.body.removeChild(host);
  }
}
