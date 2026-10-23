import type { Gradiliste, RadniNalog, Vozilo, VoziloDokument } from '@/types';
import { supabase } from '@/lib/supabase';
import { fetchNalogIzvrsenje, fetchNalogRadnikVrijeme, fetchNalogStavke, fetchNalogZadaci, fetchVoziloDokumenti } from '@/lib/api';
import { nextServis } from '@/lib/servis';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const fmtDate = (s?: string | null) => (s ? new Date(s.length <= 10 ? `${s}T00:00:00` : s).toLocaleDateString('hr-HR') : '');
const hhmm = (s?: string | null) => (s ? s.slice(0, 5) : '');
const num = (n?: number | null) => (n == null ? '' : n.toLocaleString('hr-HR'));

async function fetchVoziloZaNalog(nalogId: string): Promise<Vozilo | null> {
  try {
    const { data } = await supabase.from('dnevni_raspored_gradilista').select('vozilo_id').eq('nalog_id', nalogId).limit(1).maybeSingle();
    if (!data?.vozilo_id) return null;
    const { data: v } = await supabase.from('vozila').select('*').eq('id', data.vozilo_id).maybeSingle();
    return (v as Vozilo | null) ?? null;
  } catch {
    return null;
  }
}

const style = `<style>
  .pg{width:794px;box-sizing:border-box;padding:30px 34px;background:#fff;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:12.5px}
  .top{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px}
  .top h1{margin:0;font-size:22px;letter-spacing:1.5px}.top .f{font-size:11px;color:#64748b;margin-top:2px}
  .top .br{font-size:15px;font-weight:700;text-align:right;color:#0f172a}.top .d{font-size:11px;color:#64748b;text-align:right}
  .frm{border:1.6px solid #0f172a;border-radius:6px;overflow:hidden}
  .row{display:flex;border-bottom:1px solid #94a3b8}.row:last-child{border-bottom:0}
  .lab{width:120px;padding:7px 9px;font-weight:700;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;background:#f1f5f9;border-right:1px solid #94a3b8;display:flex;align-items:center}
  .val{flex:1;padding:7px 10px;font-weight:600;font-size:13px;display:flex;align-items:center;min-height:18px}
  .hl{color:#b91c1c}
  .two{display:flex;border-top:1px solid #94a3b8}
  .two>.l{flex:1.05;border-right:1.6px solid #0f172a}.two>.r{flex:1}
  .w{display:flex;border-bottom:1px solid #94a3b8;height:31px}.w:last-child{border-bottom:0}
  .w .n{width:30px;text-align:center;color:#64748b;border-right:1px solid #94a3b8;display:flex;align-items:center;justify-content:center;font-size:11.5px;background:#f8fafc}
  .w .t{flex:1;padding:0 10px;display:flex;align-items:center;font-weight:600}
  .w .t small{font-weight:500;color:#64748b;margin-left:8px;font-size:10.5px}
  .r .row{height:31px;border-bottom:1px solid #94a3b8}.r .row:last-child{border-bottom:0}
  .r .lab{width:128px;background:#f8fafc;font-weight:600}
  .box{border:1.6px solid #0f172a;border-radius:6px;margin-top:12px;overflow:hidden}
  .box .h{padding:6px 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f1f5f9;border-bottom:1px solid #94a3b8}
  .box .b{padding:6px 10px}
  .cols{display:flex;margin-top:12px;gap:0;border:1.6px solid #0f172a;border-radius:6px;overflow:hidden}
  .cols>div{flex:1}.cols>div+div{border-left:1.6px solid #0f172a}
  .cols .h{padding:6px 10px;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f1f5f9;border-bottom:1px solid #94a3b8}
  .ln{height:26px;border-bottom:1px dotted #64748b;padding:0 10px;display:flex;align-items:center;font-size:12.5px}
  .ln:last-child{border-bottom:0}
  .it{display:flex;gap:8px;align-items:center}
  .ck{display:inline-block;width:11px;height:11px;border:1.5px solid #334155;border-radius:2px;flex:none}
  .sig{display:flex;gap:50px;margin-top:22px}.sig div{flex:1;border-top:1px solid #0f172a;padding-top:3px;font-size:10px;color:#475569;text-align:center}
  .ft{margin-top:12px;font-size:9.5px;color:#94a3b8;display:flex;justify-content:space-between}
</style>`;

const lines = (items: string[], total: number, check = false) => {
  const rows = items.map((t) => `<div class="ln">${check ? '<span class="it"><span class="ck"></span>' : ''}${esc(t)}${check ? '</span>' : ''}</div>`);
  while (rows.length < total) rows.push('<div class="ln">&nbsp;</div>');
  return rows.join('');
};

export async function downloadNalogPdf(nalog: RadniNalog, gradiliste?: Pick<Gradiliste, 'naziv' | 'adresa'> | null) {
  const [vrijeme, zadaci, stavke, vozilo, izv, html2canvasMod, jspdfMod] = await Promise.all([
    fetchNalogRadnikVrijeme(nalog.id).catch(() => []),
    fetchNalogZadaci(nalog.id).catch(() => []),
    fetchNalogStavke(nalog.id).catch(() => []),
    fetchVoziloZaNalog(nalog.id),
    fetchNalogIzvrsenje(nalog.id).catch(() => null),
    import('html2canvas'),
    import('jspdf'),
  ]);
  const html2canvas = html2canvasMod.default;
  const { jsPDF } = jspdfMod;

  let dokumenti: VoziloDokument[] = [];
  if (vozilo) dokumenti = await fetchVoziloDokumenti(vozilo.id).catch(() => []);
  const servis = vozilo ? nextServis(vozilo, dokumenti) : { km: null, datum: null };
  const latest = (vrsta: string) => dokumenti.filter((d) => d.vrsta === vrsta && d.datum_do).sort((a, b) => (b.datum_do ?? '').localeCompare(a.datum_do ?? ''))[0];
  const kasko = latest('kasko');
  const enc = latest('enc');

  const radnici = nalog.radnici ?? [];
  const vr = new Map(vrijeme.map((v) => [v.radnik_id, v]));
  const poslovodjaId = izv?.poslovodja_id ?? nalog.poslovodja_id ?? null;
  const poslovodja = radnici.find((r) => r.id === poslovodjaId);
  const vozacId = izv?.vozac_id ?? nalog.vozac_id ?? poslovodjaId;
  const vozac = radnici.find((r) => r.id === vozacId);
  const od = vrijeme.map((v) => hhmm(v.vrijeme_od)).filter(Boolean).sort()[0];
  const doo = vrijeme.map((v) => hhmm(v.vrijeme_do)).filter(Boolean).sort().reverse()[0];
  const radnoVrijeme = od && doo ? `${od} – ${doo}` : '';

  const rowCount = Math.max(8, radnici.length);
  const workerRows = Array.from({ length: rowCount }, (_, i) => {
    const rd = radnici[i];
    const t = rd ? vr.get(rd.id) : undefined;
    const vrijemeTxt = t?.vrijeme_od || t?.vrijeme_do ? `${hhmm(t.vrijeme_od)}–${hhmm(t.vrijeme_do)}` : '';
    return `<div class="w"><div class="n">${i + 1}.</div><div class="t">${rd ? `${esc(`${rd.prezime} ${rd.ime}`)}${vrijemeTxt ? `<small>${vrijemeTxt}</small>` : ''}` : ''}</div></div>`;
  }).join('');

  const kmStart = izv?.km_pocetak ?? vozilo?.kilometraza ?? null;
  const r = (label: string, value: string) => `<div class="row"><div class="lab">${label}</div><div class="val">${esc(value)}</div></div>`;
  const materijal = stavke.filter((s) => s.tip === 'materijal').map((s) => s.naziv);
  const alat = stavke.filter((s) => s.tip === 'alat').map((s) => s.naziv);
  const strojevi = stavke.filter((s) => s.tip === 'stroj').map((s) => s.naziv);
  const opisLinije = [...(nalog.opis ? nalog.opis.split('\n') : []), ...zadaci.map((z) => `• ${z.naziv}`)];
  const servisTxt = [servis.km != null ? `${num(servis.km)} km` : '', servis.datum ? fmtDate(servis.datum) : ''].filter(Boolean).join(' · ');

  const html = `${style}<div class="pg">
    <div class="top"><div><h1>RADNI NALOG</h1><div class="f">TM Color</div></div>
      <div><div class="br">${esc(nalog.broj)}</div><div class="d">${esc(nalog.naslov)}</div></div></div>
    <div class="frm">
      <div class="row"><div class="lab">Datum</div><div class="val">${fmtDate(nalog.rok ?? nalog.datum_kreiranja)}</div>
        <div class="lab" style="border-left:1px solid #94a3b8">Radno vrijeme</div><div class="val">${esc(radnoVrijeme)}</div></div>
      <div class="row"><div class="lab">Gradilište</div><div class="val hl">${esc(gradiliste?.naziv ?? nalog.gradilista?.naziv ?? '')}${gradiliste?.adresa ? ` <span style="color:#64748b;font-weight:500;margin-left:8px">· ${esc(gradiliste.adresa)}</span>` : ''}</div></div>
      <div class="two">
        <div class="l">${workerRows}</div>
        <div class="r">
          ${r('Vozač', vozac ? `${vozac.prezime} ${vozac.ime}` : '')}
          ${r('Vozilo', vozilo ? `${vozilo.marka} ${vozilo.model ?? ''}`.trim() : '')}
          ${r('Poslovođa', poslovodja ? `${poslovodja.prezime} ${poslovodja.ime}` : '')}
          ${r('Polazak km', num(kmStart))}
          ${r('Dolazak km', num(izv?.km_kraj))}
          ${r('Stanje ENC-a', enc ? `${enc.naziv}${enc.iznos != null ? ` · ${num(enc.iznos)} €` : ''}` : (vozilo?.enc_broj ?? ''))}
          ${r('Sljedeći servis', servisTxt)}
          ${r('Kasko do', kasko ? fmtDate(kasko.datum_do) : '')}
        </div>
      </div>
    </div>
    <div class="box"><div class="h">Materijal uzet na gradilište</div><div class="b" style="min-height:92px">${lines(materijal, 4, true)}${alat.length ? `<div style="margin-top:4px;font-weight:700;font-size:10.5px;color:#475569;text-transform:uppercase">Alat</div>${lines(alat, 0, true)}` : ''}${strojevi.length ? `<div style="margin-top:4px;font-weight:700;font-size:10.5px;color:#475569;text-transform:uppercase">Strojevi</div>${lines(strojevi, 0, true)}` : ''}</div></div>
    <div class="cols">
      <div><div class="h">Uzeti za sljedeći dan</div>${lines([], 6)}</div>
      <div><div class="h">Povrat iz</div>${lines([], 6)}</div>
    </div>
    <div class="box"><div class="h">Opis radova</div>${lines(opisLinije, Math.max(8, opisLinije.length + 2))}</div>
    <div class="sig"><div>Poslovođa</div><div>Odgovorna osoba</div></div>
    <div class="ft"><span>TM Color · radni nalog ${esc(nalog.broj)}</span><span>Ispisano ${new Date().toLocaleDateString('hr-HR')}</span></div>
  </div>`;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;';
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    await document.fonts?.ready;
    const canvas = await html2canvas(host.querySelector('.pg') as HTMLElement, { scale: 2, backgroundColor: '#ffffff' });
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = 210;
    const pageH = 297;
    let w = pageW;
    let h = (canvas.height / canvas.width) * w;
    if (h > pageH) {
      h = pageH;
      w = (canvas.width / canvas.height) * h;
    }
    doc.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', (pageW - w) / 2, 0, w, h);
    doc.save(`Radni_nalog_${nalog.broj.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.pdf`);
  } finally {
    document.body.removeChild(host);
  }
}
