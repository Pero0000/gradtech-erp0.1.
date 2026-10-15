import { ponudaBroj, stavkaPopust, ponudaUkupno, type Ponuda, type PonudaStavka } from './ponude';
import type { PonudaPostavke } from './ponudePostavke';

const esc = (v: string | null | undefined) =>
  (v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n2 = (v: number) => v.toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (v: number) => `${n2(v)} €`;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];

const STYLE = `
  .pp { width: 718px; background: #fff; color: #1f2937; font-family: 'Segoe UI', Calibri, Arial, sans-serif; font-size: 10px; line-height: 1.35; }
  .pp * { box-sizing: border-box; }
  .pp .top { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 14px; border-bottom: 3px solid #c2410c; }
  .pp .top img { max-height: 70px; max-width: 190px; }
  .pp .brand { font-size: 22px; font-weight: 800; color: #111827; }
  .pp .doc { text-align: right; }
  .pp .doc .lbl { font-size: 10px; letter-spacing: 3px; color: #c2410c; font-weight: 700; }
  .pp .doc .num { font-size: 26px; font-weight: 800; color: #111827; line-height: 1.1; }
  .pp .doc .dt { color: #6b7280; margin-top: 2px; }
  .pp .naslov { margin: 14px 0 12px; font-size: 15px; font-weight: 700; color: #111827; }
  .pp .cards { display: flex; gap: 10px; }
  .pp .card { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 9px 11px; background: #f9fafb; }
  .pp .card h4 { margin: 0 0 5px; font-size: 8.5px; letter-spacing: 1.5px; text-transform: uppercase; color: #c2410c; }
  .pp .card .big { font-size: 11.5px; font-weight: 700; color: #111827; }
  .pp .card div { margin: 1px 0; color: #374151; }
  .pp table.t { width: 100%; border-collapse: collapse; margin-top: 14px; }
  .pp table.t th { background: #1f2937; color: #fff; font-weight: 600; font-size: 8.5px; padding: 6px 4px; text-align: center; border: 1px solid #1f2937; }
  .pp table.t td { padding: 5px 5px; border-bottom: 1px solid #e5e7eb; vertical-align: middle; font-size: 9.5px; }
  .pp table.t tr.alt td { background: #f9fafb; }
  .pp .c { text-align: center; } .pp .r { text-align: right; white-space: nowrap; } .pp .b { font-weight: 700; }
  .pp td.opis { text-align: left; }
  .pp .grp td { background: #fff1e6; color: #9a3412; font-weight: 700; font-size: 10.5px; padding: 0 9px; height: 26px; line-height: 26px; border-left: 4px solid #c2410c; border-bottom: 1px solid #fed7aa; vertical-align: middle; }
  .pp .gap td { height: 16px; padding: 0; border: 0; background: #fff; }
  .pp { padding-bottom: 24px; }
  .pp .pc { color: #c2410c; font-weight: 600; }
  .pp .sum td { background: #f3f4f6; font-weight: 700; border-top: 2px solid #1f2937; border-bottom: 0; padding: 7px 5px; }
  .pp .totwrap { display: flex; justify-content: flex-end; margin-top: 14px; }
  .pp .tot { width: 250px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
  .pp .tot div { display: flex; justify-content: space-between; padding: 6px 11px; border-bottom: 1px solid #e5e7eb; }
  .pp .tot div:last-child { background: #1f2937; color: #fff; font-size: 12px; font-weight: 700; border-bottom: 0; padding: 9px 11px; }
  .pp .nap { margin: 8px 0 0; padding: 7px 10px; border-left: 3px solid #fdba74; background: #fffaf5; color: #374151; font-size: 9px; }
  .pp .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 26px; font-size: 9.5px; }
  .pp .sig { min-width: 210px; text-align: center; }
  .pp .sig .line { border-top: 1px solid #6b7280; margin-top: 8px; padding-top: 3px; color: #111827; font-weight: 600; }
  .pp .sig .img { height: 54px; display: flex; align-items: flex-end; justify-content: center; margin-top: 14px; }
  .pp .sig .img img { max-height: 54px; max-width: 190px; }
  .pp .gap2 td { height: 12px; padding: 0; border: 0; background: #fff; }
  .pp .sig small { color: #6b7280; font-size: 8px; }
`;

function buildHtml(p: Ponuda, stavke: PonudaStavka[], s: PonudaPostavke, objektAdresa?: string | null) {
  const tot = ponudaUkupno(p, stavke);
  const datum = new Date(p.datum).toLocaleDateString('hr-HR').replace(/\.$/, '');
  const showPop = p.prikazi_popust !== false;
  const cols = showPop ? 10 : 6;

  const sections = new Map<string, PonudaStavka[]>();
  for (const st of stavke) {
    const vrsta = st.vrsta_posla?.trim() || 'Građevinsko obrtnički radovi';
    sections.set(vrsta, [...(sections.get(vrsta) ?? []), st]);
  }

  const itemRow = (st: PonudaStavka, nr: number) => {
    const pop = stavkaPopust(st, p.popust);
    const vrijednost = st.kolicina * st.cijena;
    const cijenaPop = st.cijena * (1 - pop / 100);
    const iznosPop = vrijednost * (pop / 100);
    const alt = nr % 2 === 0 ? ' class="alt"' : '';
    const head = `<td class="c">${nr}.</td><td class="opis">${esc(st.opis).replace(/\n/g, '<br>')}</td><td class="c">${esc(st.jedinica)}</td><td class="r">${n2(st.kolicina)}</td>`;
    if (!showPop) return `<tr${alt}>${head}<td class="r">${eur(cijenaPop)}</td><td class="r b">${eur(vrijednost - iznosPop)}</td></tr>`;
    return `<tr${alt}>${head}<td class="r">${eur(st.cijena)}</td><td class="r">${eur(vrijednost)}</td><td class="c pc">${pop}%</td><td class="r">${eur(cijenaPop)}</td><td class="r">${eur(iznosPop)}</td><td class="r b">${eur(vrijednost - iznosPop)}</td></tr>`;
  };

  let rows = '';
  let si = 0;
  for (const [vrsta, list] of sections) {
    if (si > 0) rows += `<tr class="gap"><td colspan="${cols}"></td></tr>`;
    rows += `<tr class="grp"><td colspan="${cols}">${ROMAN[si] ?? si + 1}. ${esc(vrsta)}</td></tr>`;
    si += 1;
    list.forEach((st, i) => { rows += itemRow(st, i + 1); });
  }

  const head = showPop
    ? `<th style="width:5%">Red. br.</th><th>Opis radova</th><th style="width:6%">Jed. mjera</th><th style="width:8%">Količina</th>
       <th style="width:9%">Cijena</th><th style="width:11%">Vrijednost radova</th><th style="width:6%">Popust</th>
       <th style="width:9%">Cijena s popustom</th><th style="width:9%">Iznos popusta</th><th style="width:11%">Ukupno s popustom</th>`
    : `<th style="width:6%">Red. br.</th><th>Opis radova</th><th style="width:8%">Jed. mjera</th><th style="width:9%">Količina</th>
       <th style="width:13%">Cijena</th><th style="width:15%">Vrijednost radova</th>`;

  const totalRow = showPop
    ? `<tr class="sum"><td colspan="5" class="r">Ukupno:</td><td class="r">${eur(tot.vrijednost)}</td><td class="c pc">${tot.vrijednost ? n2((tot.popust / tot.vrijednost) * 100).replace(',00', '') : 0}%</td><td></td><td class="r">${eur(tot.popust)}</td><td class="r">${eur(tot.neto)}</td></tr>`
    : `<tr class="sum"><td colspan="5" class="r">Ukupno:</td><td class="r">${eur(tot.neto)}</td></tr>`;

  const napomene = [p.prijenos_porezne_obveze ? s.prijenosPoreza : '', p.napomene ?? '']
    .join('\n')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => `<div class="nap avoid">${esc(l)}</div>`)
    .join('');

  const pdvRow = p.prijenos_porezne_obveze
    ? `<div><span>PDV</span><span>prijenos porezne obveze</span></div>`
    : `<div><span>PDV ${n2(p.pdv)}%</span><span>${eur(tot.pdv)}</span></div>`;

  const kontakt = [s.kontaktOsoba, s.telefon && `tel. ${s.telefon}`].filter(Boolean).join(', ');

  return `<style>${STYLE}</style><div class="pp">
  <div class="top avoid">
    <div>${s.logo ? `<img src="${s.logo}" alt="">` : `<div class="brand">${esc(s.izvodac)}</div>`}</div>
    <div class="doc"><div class="lbl">PONUDA</div><div class="num">${esc(ponudaBroj(p))}</div><div class="dt">${esc(datum)}.</div></div>
  </div>
  <div class="naslov avoid">${esc(p.naslov)}</div>
  <div class="cards avoid">
    <div class="card"><h4>Izvođač radova</h4>
      <div class="big">${esc(s.izvodac)}</div>
      ${s.adresa ? `<div>${esc(s.adresa)}</div>` : ''}
      ${s.oib ? `<div>OIB: ${esc(s.oib)}</div>` : ''}
      ${kontakt ? `<div>Kontakt: ${esc(kontakt)}</div>` : ''}
      ${s.email ? `<div>${esc(s.email)}</div>` : ''}
    </div>
    <div class="card"><h4>Investitor</h4>
      <div class="big">${esc(p.investitori?.naziv) || '—'}</div>
      <div style="margin-top:6px"><b>Izvođenje radova na adresi:</b></div>
      <div>${esc(p.adresa_radova || objektAdresa) || '—'}</div>
    </div>
  </div>
  <table class="t">
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}<tr class="gap2"><td colspan="${cols}"></td></tr>${totalRow}</tbody>
  </table>
  <div class="totwrap avoid"><div class="tot">
    <div><span>Za platiti</span><span class="b">${eur(tot.neto)}</span></div>
    ${pdvRow}
    <div><span>Ukupno s PDV-om</span><span>${eur(tot.bruto)}</span></div>
  </div></div>
  ${napomene}
  <div class="foot avoid">
    <div>Troškovnik ispunio:<br><b>${esc(s.izradio)}</b></div>
    <div class="sig"><div>${s.mjesto ? `U ${esc(s.mjesto)}, ` : ''}${esc(datum)}.</div><div class="img">${s.potpis ? `<img src="${s.potpis}" alt="">` : ''}</div><div class="line">${esc(s.izradio)}</div><small>Potpis</small></div>
  </div>
</div>`;
}

// Generira PDF u pregledniku i odmah ga preuzima
export async function exportPonudaPdf(p: Ponuda, stavke: PonudaStavka[], s: PonudaPostavke, objektAdresa?: string | null) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;';
  host.innerHTML = buildHtml(p, stavke, s, objektAdresa);
  document.body.appendChild(host);

  try {
    const root = host.querySelector('.pp') as HTMLElement;
    await document.fonts?.ready;
    await Promise.all(Array.from(host.querySelectorAll('img')).map((img) => img.decode().catch(() => undefined)));

    const scale = 3;
    const canvas = await html2canvas(root, { scale, backgroundColor: '#ffffff', useCORS: true, windowWidth: root.scrollWidth, windowHeight: root.scrollHeight });

    // Dopuštene točke prijeloma: dno redaka i blokova, da se redak ne prereže
    const rootTop = root.getBoundingClientRect().top;
    const total = Math.min(root.getBoundingClientRect().height, canvas.height / scale);
    const breaks = Array.from(root.querySelectorAll('tr, .avoid'))
      .map((el) => el.getBoundingClientRect().bottom - rootTop)
      .sort((a, b) => a - b);

    const MARGIN = 10;
    const pageW = 210;
    const contentW = pageW - MARGIN * 2;
    const mmPerPx = contentW / root.offsetWidth;
    const pageHpx = (297 - MARGIN * 2) / mmPerPx;

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let pos = 0;
    let first = true;
    while (pos < total - 1) {
      let end = total;
      if (total - pos > pageHpx) {
        const limit = pos + pageHpx;
        const candidate = [...breaks].reverse().find((b) => b > pos + 40 && b <= limit);
        end = candidate ?? limit;
      }
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = Math.max(1, Math.round((end - pos) * scale));
      const ctx = slice.getContext('2d');
      if (!ctx) throw new Error('Canvas nije dostupan');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, Math.round(pos * scale), canvas.width, slice.height, 0, 0, canvas.width, slice.height);
      if (!first) doc.addPage();
      doc.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', MARGIN, MARGIN, contentW, (end - pos) * mmPerPx);
      first = false;
      pos = end;
    }

    doc.save(`Ponuda_${p.redni_broj}-${p.godina}.pdf`);
  } finally {
    document.body.removeChild(host);
  }
}
