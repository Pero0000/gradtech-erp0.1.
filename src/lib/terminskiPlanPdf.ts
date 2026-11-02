export interface TerminskiPlanPdfRow {
  gradiliste: string;
  aktivnost: string;
  kooperant: string;
  pocetak: string;
  kraj: string;
  status: string;
  boja: string;
}

export interface TerminskiPlanPdfSpec {
  naslov: string;
  podnaslov: string;
  pocetak: string;
  dani: string[];
  redovi: TerminskiPlanPdfRow[];
  legenda: { naziv: string; boja: string }[];
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function utcDay(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateLabel(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('hr-HR', { day: 'numeric', month: 'short' });
}

function pageMarkup(spec: TerminskiPlanPdfSpec) {
  const daySlice = spec.dani;
  const periodStart = daySlice[0];
  const periodEnd = daySlice[daySlice.length - 1];
  const gridTemplate = `repeat(${daySlice.length}, minmax(0, 1fr))`;
  const labels = spec.legenda.map((item) => `
    <span class="legend-item"><i style="background:${escapeHtml(item.boja)}"></i>${escapeHtml(item.naziv)}</span>
  `).join('');
  const monthHeaders: string[] = [];
  for (let index = 0; index < daySlice.length;) {
    const monthKey = daySlice[index].slice(0, 7);
    let span = 1;
    while (index + span < daySlice.length && daySlice[index + span].slice(0, 7) === monthKey) span += 1;
    const month = new Date(`${daySlice[index]}T12:00:00`).toLocaleDateString('hr-HR', { month: 'long', year: 'numeric' });
    monthHeaders.push(`<div class="month" style="grid-column:span ${span}">${escapeHtml(month)}</div>`);
    index += span;
  }
  const monthHeaderMarkup = monthHeaders.join('');
  const dayHeaders = daySlice.map((day) => {
    const date = new Date(`${day}T12:00:00`);
    const weekday = date.toLocaleDateString('hr-HR', { weekday: 'short' }).replace('.', '').slice(0, 1);
    const sunday = date.getDay() === 0;
    const weekend = date.getDay() === 6;
    return `<div class="day ${sunday ? 'sunday' : weekend ? 'weekend' : ''}"><span>${escapeHtml(weekday)}</span><b>${date.getDate()}</b></div>`;
  }).join('');
  const rowMarkup = spec.redovi.map((row) => {
    const start = (utcDay(row.pocetak) - utcDay(spec.pocetak)) / 86400000;
    const end = (utcDay(row.kraj) - utcDay(spec.pocetak)) / 86400000;
    const intersectsPage = end >= 0 && start < daySlice.length;
    const visibleStart = Math.max(0, start);
    const visibleEnd = Math.min(daySlice.length - 1, end);
    const left = (visibleStart / daySlice.length) * 100;
    const width = (Math.max(1, visibleEnd - visibleStart + 1) / daySlice.length) * 100;
    const weekendCells = daySlice.map((day) => {
      const date = new Date(`${day}T12:00:00`);
      return `<i class="cell ${date.getDay() === 0 ? 'sunday' : date.getDay() === 6 ? 'weekend' : ''}"></i>`;
    }).join('');
    const contractor = row.kooperant ? `<span class="contractor">${escapeHtml(row.kooperant)}</span>` : '';
    return `
      <div class="grid-row">
      <div class="task-label">
        <b>${escapeHtml(row.aktivnost)}</b>
        <span>${escapeHtml(row.gradiliste)}${contractor ? ` · ${contractor}` : ''} · ${escapeHtml(row.status)}</span>
      </div>
      <div class="timeline-row">
        <div class="cells" style="grid-template-columns:${gridTemplate}">${weekendCells}</div>
        ${intersectsPage ? `<div class="bar" style="left:${left}%;width:${width}%;background:${escapeHtml(row.boja)}" title="${escapeHtml(row.status)}"></div>` : ''}
      </div>
      </div>`;
  }).join('');

  return `
    <style>
      *{box-sizing:border-box}
      .page{width:1500px;padding:24px 28px;background:#fff;color:#0f172a;font-family:Arial,Segoe UI,sans-serif}
      .heading{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0f172a;padding-bottom:8px;margin-bottom:6px;gap:16px}
      h1{font-size:26px;margin:0 0 4px}.subtitle{font-size:13px;color:#475569;line-height:1.3}
      .period{font-size:14px;font-weight:700;color:#334155;white-space:nowrap}
      .legend{display:flex;flex-wrap:wrap;gap:5px 12px;padding:6px 0 8px;font-size:11px;color:#334155}
      .legend-item{display:flex;align-items:center;gap:5px;white-space:nowrap}
      .legend i{width:11px;height:11px;border-radius:3px;display:inline-block}
      .grid-head,.grid-row{display:grid;grid-template-columns:420px minmax(0,1fr)}
      .grid-head{border:1px solid #cbd5e1;background:#f8fafc}
      .label-head{display:flex;align-items:center;padding:6px 10px;font-size:13px;font-weight:700;border-right:1px solid #cbd5e1}
      .month-band,.days{display:grid;grid-template-columns:${gridTemplate}}
      .month-band{height:18px;border:1px solid #cbd5e1;border-bottom:0;background:#f8fafc}
      .month{min-width:0;overflow:hidden;text-align:center;text-overflow:ellipsis;white-space:nowrap;border-right:1px solid #cbd5e1;padding:2px 1px;font-size:9px;font-weight:700;color:#475569;text-transform:capitalize}
      .day{height:38px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;border-right:1px solid #cbd5e1;font-size:7px;color:#475569}
      .day b{font-size:9px;color:#0f172a}
      .weekend{background:#f1f5f9}
      .sunday{background:#ffe4e6;color:#9f1239;border-right:2px solid #fda4af}
      .grid-row{min-height:30px;border:1px solid #e2e8f0;border-top:0}
      .task-label{min-width:0;display:flex;flex-direction:column;justify-content:center;gap:2px;padding:3px 8px;border-right:1px solid #cbd5e1;overflow:visible}
      .task-label b,.task-label span{white-space:normal;overflow-wrap:anywhere;line-height:1.3}
      .task-label b{font-size:12px}.task-label span{font-size:10px;color:#64748b}
      .contractor{color:#334155;font-weight:700}
      .timeline-row{position:relative;min-width:0}
      .cells{position:absolute;inset:0;display:grid}
      .cell{border-right:1px solid #e2e8f0}
      .cell.weekend{background:#f8fafc}
      .cell.sunday{background:#fff1f2;border-right:2px solid #fecdd3}
      .bar{position:absolute;top:50%;height:9px;min-width:4px;transform:translateY(-50%);border-radius:8px;box-shadow:0 1px 2px #0f172a33}
      .footer{display:flex;justify-content:space-between;margin-top:7px;padding-top:4px;border-top:1px solid #cbd5e1;font-size:9px;color:#64748b}
    </style>
    <div class="page">
      <div class="heading">
        <div><h1>${escapeHtml(spec.naslov)}</h1><div class="subtitle">${escapeHtml(spec.podnaslov)}</div></div>
        <div class="period">${escapeHtml(dateLabel(periodStart))} – ${escapeHtml(dateLabel(periodEnd))}</div>
      </div>
      <div class="legend">${labels}</div>
      <div class="grid-head">
        <div class="label-head">Gradilište / aktivnost</div>
        <div>
          <div class="month-band">${monthHeaderMarkup}</div>
          <div class="days">${dayHeaders}</div>
        </div>
      </div>
      ${rowMarkup}
      <div class="footer"><span>GradTech · Terminski plan</span><span>${daySlice.length} dana · ${spec.redovi.length} aktivnosti · jedna stranica</span></div>
    </div>`;
}

export async function exportTerminskiPlanPdf(spec: TerminskiPlanPdfSpec) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;background:#fff;';
  document.body.appendChild(host);

  try {
    await document.fonts?.ready;
    host.innerHTML = pageMarkup(spec);
    const element = host.querySelector('.page');
    if (!(element instanceof HTMLElement)) throw new Error('Nije moguće pripremiti prikaz terminskog plana za PDF.');
    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: '#ffffff',
      windowWidth: 1500,
      windowHeight: element.scrollHeight,
      height: element.scrollHeight,
    });
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    const margin = 6;
    const pageWidth = 297 - margin * 2;
    const pageHeight = 210 - margin * 2;
    const scale = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    const width = canvas.width * scale;
    const height = canvas.height * scale;
    doc.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', (297 - width) / 2, (210 - height) / 2, width, height);
    doc.save(`Terminski_plan_${new Date().toISOString().slice(0, 10)}.pdf`);
  } finally {
    document.body.removeChild(host);
  }
}
