import { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, CheckCircle2, Clock, FileDown, FileSignature, Pencil, Plus, Search, Settings2, Trash2, XCircle } from 'lucide-react';
import type { Investitor, Objekt } from '@/types';
import { fetchAllObjekti, fetchInvestitori } from '@/lib/api';
import {
  deletePonuda, fetchPonude, fetchSvePonudeStavke, ponudaBroj, ponudaUkupno, updatePonuda,
  type Ponuda, type PonudaStatus, type PonudaStavka,
} from '@/lib/ponude';
import { fetchStavke, type Stavka } from '@/lib/stavke';
import { exportPonudaPdf } from '@/lib/ponudaPdf';
import { loadPonudaPostavke, savePonudaPostavkeRemote, syncPonudaPostavke, type PonudaPostavke } from '@/lib/ponudePostavke';
import { PonudaEditor, convertToGradiliste, statusLabel } from '@/components/views/PonudaEditor';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field, Textarea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ExportMenu } from '@/components/ui/ExportMenu';

const eur = (v: number) => v.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Greška');

const statusVariant: Record<PonudaStatus, 'green' | 'yellow' | 'red'> = { potvrdena: 'green', nepotvrdena: 'yellow', odbijena: 'red' };

function SignaturePad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111827';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const up = () => {
    if (!drawing.current || !ref.current) return;
    drawing.current = false;
    onChange(ref.current.toDataURL('image/png'));
  };

  const clear = () => {
    const c = ref.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    onChange('');
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">Elektronički potpis</p>
      <canvas
        ref={ref}
        width={600}
        height={180}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        className="w-full max-w-md touch-none rounded-lg border border-dashed border-slate-300 bg-white"
        style={{ aspectRatio: '10 / 3' }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs text-slate-500">Potpiši mišem/prstom ili učitaj sliku potpisa.</span>
        <input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} className="text-xs" />
        {value && <button type="button" onClick={clear} className="text-xs text-red-600 hover:underline">Ukloni potpis</button>}
      </div>
      {value && (
        <div className="mt-2">
          <p className="text-xs text-slate-500">Spremljeni potpis:</p>
          <img src={value} alt="Potpis" className="h-14 rounded border border-slate-200 bg-white p-1" />
        </div>
      )}
    </div>
  );
}

function PostavkeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [p, setP] = useState<PonudaPostavke>(loadPonudaPostavke);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setP(loadPonudaPostavke());
    syncPonudaPostavke().then(setP).catch((e) => setErr(errText(e)));
  }, [open]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await savePonudaPostavkeRemote(p);
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof PonudaPostavke>(k: K, v: PonudaPostavke[K]) => setP((prev) => ({ ...prev, [k]: v }));

  const onLogo = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set('logo', String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide="md"
      title="Postavke ponude"
      footer={(
        <>
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Odustani</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">{saving ? 'Spremanje…' : 'Spremi'}</button>
        </>
      )}
    >
      <div className="space-y-4">
        {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
        <p className="text-xs text-slate-500">Ove postavke koriste se u zaglavlju i podnožju PDF-a te kao zadane vrijednosti kod nove ponude. Spremaju se u bazu i vrijede na svim računalima.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Izvođač radova"><TextInput value={p.izvodac} onChange={(e) => set('izvodac', e.target.value)} /></Field>
          <Field label="OIB"><TextInput value={p.oib} onChange={(e) => set('oib', e.target.value)} /></Field>
          <Field label="Mjesto, ulica i kućni broj"><TextInput value={p.adresa} onChange={(e) => set('adresa', e.target.value)} /></Field>
          <Field label="Mjesto (u podnožju, npr. Ozalj)"><TextInput value={p.mjesto} onChange={(e) => set('mjesto', e.target.value)} /></Field>
          <Field label="Kontakt osoba"><TextInput value={p.kontaktOsoba} onChange={(e) => set('kontaktOsoba', e.target.value)} /></Field>
          <Field label="Troškovnik ispunio"><TextInput value={p.izradio} onChange={(e) => set('izradio', e.target.value)} /></Field>
          <Field label="Telefon"><TextInput value={p.telefon} onChange={(e) => set('telefon', e.target.value)} /></Field>
          <Field label="E-mail"><TextInput value={p.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Zadani PDV (%)"><TextInput type="number" value={p.pdv} onChange={(e) => set('pdv', parseFloat(e.target.value) || 0)} /></Field>
          <Field label="Zadani popust (%)"><TextInput type="number" value={p.popust} onChange={(e) => set('popust', parseFloat(e.target.value) || 0)} /></Field>
        </div>
        <Field label="Zadane napomene (svaki red je odlomak)"><Textarea rows={6} value={p.napomene} onChange={(e) => set('napomene', e.target.value)} /></Field>
        <Field label="Napomena o prijenosu porezne obveze (ispisuje se kad je uključeno na ponudi)"><Textarea rows={2} value={p.prijenosPoreza} onChange={(e) => set('prijenosPoreza', e.target.value)} /></Field>
        <SignaturePad key={String(open)} value={p.potpis} onChange={(v) => set('potpis', v)} />
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Logo</p>
          <div className="flex items-center gap-3">
            {p.logo && <img src={p.logo} alt="Logo" className="h-14 rounded border border-slate-200 p-1" />}
            <input type="file" accept="image/*" onChange={(e) => onLogo(e.target.files?.[0])} className="text-sm" />
            {p.logo && <button type="button" onClick={() => set('logo', '')} className="text-xs text-red-600 hover:underline">Ukloni</button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function PonudeView() {
  const [ponude, setPonude] = useState<Ponuda[]>([]);
  const [stavke, setStavke] = useState<PonudaStavka[]>([]);
  const [baza, setBaza] = useState<Stavka[]>([]);
  const [investitori, setInvestitori] = useState<Investitor[]>([]);
  const [objekti, setObjekti] = useState<Objekt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | PonudaStatus>('');
  const [godina, setGodina] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Ponuda | null>(null);
  const [postavkeOpen, setPostavkeOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Ponuda | null>(null);
  const [convertTarget, setConvertTarget] = useState<Ponuda | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [p, s, b, i, o] = await Promise.all([fetchPonude(), fetchSvePonudeStavke(), fetchStavke().catch(() => [] as Stavka[]), fetchInvestitori(), fetchAllObjekti()]);
      setPonude(p);
      setStavke(s);
      setBaza(b);
      setInvestitori(i);
      setObjekti(o);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    syncPonudaPostavke().catch(() => undefined);
  }, []);

  const stavkeOf = useMemo(() => {
    const map = new Map<string, PonudaStavka[]>();
    stavke.forEach((s) => map.set(s.ponuda_id, [...(map.get(s.ponuda_id) ?? []), s]));
    return map;
  }, [stavke]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ponude
      .filter((p) => (!statusFilter || p.status === statusFilter) && (!godina || String(p.godina) === godina))
      .filter((p) => !q || [ponudaBroj(p), p.naslov, p.investitori?.naziv, p.adresa_radova].some((v) => (v ?? '').toLowerCase().includes(q)))
      .map((p) => ({ p, list: stavkeOf.get(p.id) ?? [], tot: ponudaUkupno(p, stavkeOf.get(p.id) ?? []) }));
  }, [ponude, stavkeOf, query, statusFilter, godina]);

  const sum = (status?: PonudaStatus) => rows.filter((r) => !status || r.p.status === status).reduce((a, r) => a + r.tot.neto, 0);
  const count = (status: PonudaStatus) => rows.filter((r) => r.p.status === status).length;
  const total = sum();
  const potvrdeno = sum('potvrdena');
  const nepotvrdeno = sum('nepotvrdena');
  const odbijeno = sum('odbijena');
  const pct = (v: number) => (total ? (v / total) * 100 : 0);
  const godine = [...new Set(ponude.map((p) => String(p.godina)))];

  const changeStatus = async (p: Ponuda, status: PonudaStatus) => {
    try {
      await updatePonuda(p.id, { status });
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  const doConvert = async () => {
    if (!convertTarget) return;
    try {
      await convertToGradiliste(convertTarget, stavkeOf.get(convertTarget.id) ?? [], objekti);
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  const openPdf = (p: Ponuda) => {
    setPdfId(p.id);
    exportPonudaPdf(p, stavkeOf.get(p.id) ?? [], loadPonudaPostavke(), objekti.find((o) => o.id === p.objekt_id)?.adresa)
      .catch((e) => setError(errText(e)))
      .finally(() => setPdfId(null));
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;

  const kpis = [
    { label: 'Ukupno ponuda', value: String(rows.length), sub: `${eur(total)} bez PDV-a`, icon: FileSignature, cls: 'bg-sky-50 text-sky-600' },
    { label: 'Potvrđene', value: eur(potvrdeno), sub: `${count('potvrdena')} ponuda`, icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-600' },
    { label: 'Nepotvrđene', value: eur(nepotvrdeno), sub: `${count('nepotvrdena')} ponuda na čekanju`, icon: Clock, cls: 'bg-amber-50 text-amber-600' },
    { label: 'Odbijene', value: eur(odbijeno), sub: `${count('odbijena')} ponuda`, icon: XCircle, cls: 'bg-red-50 text-red-600' },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Ponude</h1>
          <p className="mt-1 text-sm text-slate-500">Izrada ponuda iz baze stavki, PDF izvoz i pretvorba u planirano gradilište</p>
        </div>
        <div className="flex gap-2">
          <ExportMenu
            disabled={rows.length === 0}
            build={() => ({
              file: 'Ponude',
              title: 'Ponude',
              rows,
              columns: [
                { header: 'Broj', get: (r: (typeof rows)[number]) => ponudaBroj(r.p) },
                { header: 'Naslov', get: (r: (typeof rows)[number]) => r.p.naslov },
                { header: 'Investitor', get: (r: (typeof rows)[number]) => r.p.investitori?.naziv ?? '' },
                { header: 'Adresa radova', get: (r: (typeof rows)[number]) => r.p.adresa_radova ?? '' },
                { header: 'Datum', kind: 'date', get: (r: (typeof rows)[number]) => r.p.datum },
                { header: 'Status', get: (r: (typeof rows)[number]) => (r.p.status === 'potvrdena' ? 'Potvrđena' : r.p.status === 'odbijena' ? 'Odbijena' : 'Nepotvrđena') },
                { header: 'Stavki', kind: 'num', get: (r: (typeof rows)[number]) => r.list.length },
                { header: 'Iznos bez PDV-a', kind: 'eur', get: (r: (typeof rows)[number]) => r.tot.neto },
                { header: 'Ukupno s PDV-om', kind: 'eur', get: (r: (typeof rows)[number]) => r.tot.bruto },
              ],
              totals: { 'Iznos bez PDV-a': total, 'Ukupno s PDV-om': rows.reduce((a, r) => a + r.tot.bruto, 0) },
            })}
          />
          <button onClick={() => setPostavkeOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Settings2 className="h-4 w-4" /> Postavke
          </button>
          <button onClick={() => { setEditing(null); setEditorOpen(true); }} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-700">
            <Plus className="h-4 w-4" /> Nova ponuda
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${k.cls}`}><k.icon className="h-5 w-5" /></div>
              <div>
                <p className="text-xs text-slate-500">{k.label}</p>
                <p className="text-lg font-bold text-slate-900">{k.value}</p>
                <p className="text-xs text-slate-400">{k.sub}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>Udio po vrijednosti</span>
          <span className="font-semibold text-emerald-700">Uspješnost: {pct(potvrdeno).toFixed(0)}%</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          <div className="bg-emerald-500" style={{ width: `${pct(potvrdeno)}%` }} title="Potvrđene" />
          <div className="bg-amber-400" style={{ width: `${pct(nepotvrdeno)}%` }} title="Nepotvrđene" />
          <div className="bg-red-400" style={{ width: `${pct(odbijeno)}%` }} title="Odbijene" />
        </div>
        <div className="mt-2 flex gap-4 text-xs text-slate-500">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Potvrđene</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />Nepotvrđene</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-400" />Odbijene</span>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Traži po broju, naslovu, investitoru, adresi…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | PonudaStatus)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">Svi statusi</option>
          {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={godina} onChange={(e) => setGodina(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">Sve godine</option>
          {godine.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      {ponude.length === 0 ? (
        <EmptyState icon={<FileSignature className="h-7 w-7" />} title="Nema ponuda" description="Kreiraj prvu ponudu iz baze stavki." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-3 text-left">Broj</th>
                <th className="px-3 py-3 text-left">Naslov</th>
                <th className="px-3 py-3 text-left">Investitor</th>
                <th className="px-3 py-3 text-left">Datum</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3 text-right">Stavki</th>
                <th className="px-3 py-3 text-right">Vrijednost</th>
                <th className="px-3 py-3 text-right">Popust</th>
                <th className="px-3 py-3 text-right">Bez PDV-a</th>
                <th className="px-3 py-3 text-right">S PDV-om</th>
                <th className="px-3 py-3 text-left">Gradilište</th>
                <th className="px-3 py-3 text-right">Akcije</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ p, list, tot }) => (
                <tr key={p.id} className="group hover:bg-slate-50">
                  <td className="px-3 py-3 font-semibold text-slate-900">{ponudaBroj(p)}</td>
                  <td className="px-3 py-3"><button type="button" onClick={() => { setEditing(p); setEditorOpen(true); }} className="text-left font-medium text-slate-800 hover:text-sky-600">{p.naslov}</button>{p.adresa_radova && <p className="text-xs text-slate-400">{p.adresa_radova}</p>}</td>
                  <td className="px-3 py-3 text-slate-600">{p.investitori?.naziv ?? '—'}</td>
                  <td className="px-3 py-3 text-slate-600">{new Date(p.datum).toLocaleDateString('hr-HR')}</td>
                  <td className="px-3 py-3">
                    <select value={p.status} onChange={(e) => void changeStatus(p, e.target.value as PonudaStatus)} className="rounded-md border-0 bg-transparent p-0 text-xs focus:ring-0">
                      {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <div className="mt-0.5"><Badge variant={statusVariant[p.status]}>{statusLabel[p.status]}</Badge></div>
                  </td>
                  <td className="px-3 py-3 text-right text-slate-600">{list.length}</td>
                  <td className="px-3 py-3 text-right text-slate-600">{eur(tot.vrijednost)}</td>
                  <td className="px-3 py-3 text-right text-red-600">{tot.popust ? `− ${eur(tot.popust)}` : '—'}</td>
                  <td className="px-3 py-3 text-right font-semibold text-slate-900">{eur(tot.neto)}</td>
                  <td className="px-3 py-3 text-right text-slate-700">{eur(tot.bruto)}</td>
                  <td className="px-3 py-3">
                    {p.gradiliste_id ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Building2 className="h-3.5 w-3.5" /> Pretvoreno</span>
                    ) : p.status === 'potvrdena' ? (
                      <button type="button" onClick={() => setConvertTarget(p)} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700">U gradilište</button>
                    ) : <span className="text-xs text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => openPdf(p)} disabled={pdfId !== null} title="PDF" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600">
                        {pdfId === p.id ? <span className="block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" /> : <FileDown className="h-4 w-4" />}
                      </button>
                      <button onClick={() => { setEditing(p); setEditorOpen(true); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => setDeleteTarget(p)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 text-sm font-semibold">
                <td colSpan={6} className="px-3 py-3 text-right text-slate-600">Ukupno ({rows.length})</td>
                <td className="px-3 py-3 text-right">{eur(rows.reduce((a, r) => a + r.tot.vrijednost, 0))}</td>
                <td className="px-3 py-3 text-right text-red-600">{eur(rows.reduce((a, r) => a + r.tot.popust, 0))}</td>
                <td className="px-3 py-3 text-right">{eur(total)}</td>
                <td className="px-3 py-3 text-right">{eur(rows.reduce((a, r) => a + r.tot.bruto, 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <PonudaEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => void load()}
        ponuda={editing}
        ponudaStavke={editing ? stavkeOf.get(editing.id) ?? [] : []}
        investitori={investitori}
        objekti={objekti}
        baza={baza}
        onBazaChanged={() => void fetchStavke().then(setBaza).catch(() => undefined)}
        onLookupsChanged={() => void Promise.all([fetchInvestitori(), fetchAllObjekti()]).then(([i, o]) => { setInvestitori(i); setObjekti(o); })}
      />
      <PostavkeModal open={postavkeOpen} onClose={() => setPostavkeOpen(false)} />
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await deletePonuda(deleteTarget.id);
            await load();
          } catch (e) {
            setError(errText(e));
          }
        }}
        title="Izbrisati ponudu?"
        message="Ponuda i njezine stavke bit će trajno obrisane. Gradilište koje je iz nje nastalo ostaje."
      />
      <ConfirmDialog
        open={convertTarget !== null}
        onClose={() => setConvertTarget(null)}
        onConfirm={doConvert}
        title="Pretvoriti u gradilište?"
        message="Kreira se planirano gradilište s ugovorenom vrijednošću ponude (bez PDV-a)."
      />
    </div>
  );
}
