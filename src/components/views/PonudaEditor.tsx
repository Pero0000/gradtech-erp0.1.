import { useEffect, useMemo, useState } from 'react';
import { ArrowUpFromLine, FileDown, Search, Trash2, ListPlus, FilePlus2, Building2 } from 'lucide-react';
import type { Investitor, Objekt } from '@/types';
import { createGradiliste, createInvestitor, createObjekt } from '@/lib/api';
import {
  createPonuda, ponudaBroj, ponudaUkupno, replacePonudaStavke, updatePonuda,
  type Ponuda, type PonudaStatus, type PonudaStavka,
} from '@/lib/ponude';
import { createStavka, updateStavka, type Stavka } from '@/lib/stavke';
import { loadPonudaPostavke } from '@/lib/ponudePostavke';
import { exportPonudaPdf } from '@/lib/ponudaPdf';
import { Field, Select, Textarea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

interface Line {
  key: string;
  stavka_id: string | null;
  opis: string;
  jedinica: string;
  kolicina: string;
  cijena: string;
  popust: string;
  vrsta: string;
  podgrupa: string;
  spremiUBazu: boolean;
}

const jedinice = ['m2', 'm', 'm1', 'm3', 'kom', 'h', 'kg', 'l', 'paušal'];
const pn = (v: string) => parseFloat(v.replace(',', '.')) || 0;
const eur = (v: number) => v.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const today = () => new Date().toISOString().slice(0, 10);
const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Greška');
let seq = 0;
const newKey = () => `l${++seq}`;

export const statusLabel: Record<PonudaStatus, string> = {
  nepotvrdena: 'Nepotvrđena',
  potvrdena: 'Potvrđena',
  odbijena: 'Odbijena',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  ponuda: Ponuda | null;
  ponudaStavke: PonudaStavka[];
  investitori: Investitor[];
  objekti: Objekt[];
  baza: Stavka[];
  onBazaChanged: () => void;
  onLookupsChanged: () => void;
}

export function PonudaEditor({ open, onClose, onSaved, ponuda, ponudaStavke, investitori, objekti, baza, onBazaChanged, onLookupsChanged }: Props) {
  const [form, setForm] = useState({
    naslov: '', investitor_id: '', objekt_id: '', adresa_radova: '', datum: today(),
    status: 'nepotvrdena' as PonudaStatus, popust: '0', pdv: '25', napomene: '',
    prikazi_popust: true, prijenos: false,
  });
  const [quick, setQuick] = useState<null | 'investitor' | 'objekt'>(null);
  const [quickForm, setQuickForm] = useState({ naziv: '', oib: '', adresa: '', mjesto: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSearch('');
    if (ponuda) {
      setForm({
        naslov: ponuda.naslov, investitor_id: ponuda.investitor_id ?? '', objekt_id: ponuda.objekt_id ?? '',
        adresa_radova: ponuda.adresa_radova ?? '', datum: ponuda.datum, status: ponuda.status,
        popust: String(ponuda.popust), pdv: String(ponuda.pdv), napomene: ponuda.napomene ?? '',
        prikazi_popust: ponuda.prikazi_popust !== false, prijenos: !!ponuda.prijenos_porezne_obveze,
      });
      setLines(ponudaStavke.map((s) => ({
        key: newKey(), stavka_id: s.stavka_id, opis: s.opis, jedinica: s.jedinica,
        kolicina: String(s.kolicina), cijena: String(s.cijena), popust: s.popust ? String(s.popust) : '',
        vrsta: s.vrsta_posla ?? '', podgrupa: s.podgrupa ?? '', spremiUBazu: false,
      })));
    } else {
      const p = loadPonudaPostavke();
      setForm({
        naslov: '', investitor_id: '', objekt_id: '', adresa_radova: '', datum: today(),
        status: 'nepotvrdena', popust: String(p.popust), pdv: String(p.pdv), napomene: p.napomene,
        prikazi_popust: true, prijenos: false,
      });
      setLines([]);
    }
    setQuick(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ponuda?.id]);

  const bazaById = useMemo(() => new Map(baza.map((s) => [s.id, s])), [baza]);
  const objektiInv = objekti.filter((o) => !form.investitor_id || o.investitor_id === form.investitor_id);

  const suggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return baza.filter((s) => [s.naziv, s.sifra, s.vrsta_posla].some((v) => (v ?? '').toLowerCase().includes(q))).slice(0, 8);
  }, [baza, search]);

  const asStavke: PonudaStavka[] = lines.map((l, i) => ({
    id: l.key, ponuda_id: '', stavka_id: l.stavka_id, redoslijed: i, opis: l.opis, jedinica: l.jedinica,
    vrsta_posla: l.vrsta.trim() || null, podgrupa: l.podgrupa.trim() || null,
    kolicina: pn(l.kolicina), cijena: pn(l.cijena), popust: form.prikazi_popust ? pn(l.popust) : 0,
  }));
  const tot = ponudaUkupno({ popust: form.prikazi_popust ? pn(form.popust) : 0, pdv: form.prijenos ? 0 : pn(form.pdv) }, asStavke);

  const vrste = useMemo(() => [...new Set([...baza.map((s) => s.vrsta_posla), ...lines.map((l) => l.vrsta)].filter((v): v is string => !!v && !!v.trim()))].sort(), [baza, lines]);

  const addFromBase = (s: Stavka) => {
    setLines((prev) => [...prev, {
      key: newKey(), stavka_id: s.id, opis: s.opis?.trim() || s.naziv, jedinica: s.jedinica,
      kolicina: '1', cijena: String(s.cijena), popust: '', vrsta: s.vrsta_posla ?? '', podgrupa: s.podgrupa ?? '', spremiUBazu: false,
    }]);
    setSearch('');
  };

  const addNew = () =>
    setLines((prev) => [...prev, {
      key: newKey(), stavka_id: null, opis: '', jedinica: 'm2', kolicina: '1', cijena: '0', popust: '',
      vrsta: prev[prev.length - 1]?.vrsta ?? '', podgrupa: prev[prev.length - 1]?.podgrupa ?? '', spremiUBazu: true,
    }]);

  const patch = (key: string, p: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const pushToBase = async (l: Line) => {
    const s = l.stavka_id ? bazaById.get(l.stavka_id) : undefined;
    if (!s) return;
    try {
      await updateStavka(s.id, { sifra: s.sifra, naziv: s.naziv, vrsta_posla: s.vrsta_posla, podgrupa: s.podgrupa, jedinica: l.jedinica, cijena: pn(l.cijena), opis: s.opis }, s.cijena);
      onBazaChanged();
    } catch (e) {
      setError(errText(e));
    }
  };

  const onInvestitor = (id: string) => setForm((f) => ({ ...f, investitor_id: id, objekt_id: '' }));

  const openQuick = (kind: 'investitor' | 'objekt') => {
    if (kind === 'objekt' && !form.investitor_id) {
      setError('Prvo odaberi investitora za novi objekt.');
      return;
    }
    setError(null);
    setQuickForm({ naziv: '', oib: '', adresa: '', mjesto: '' });
    setQuick(kind);
  };

  const saveQuick = async () => {
    if (!quickForm.naziv.trim()) return;
    try {
      if (quick === 'investitor') {
        const inv = await createInvestitor({
          naziv: quickForm.naziv.trim(), oib: quickForm.oib.trim() || null,
          adresa: quickForm.adresa.trim() || null, mjesto: quickForm.mjesto.trim() || null,
        });
        setForm((f) => ({ ...f, investitor_id: inv.id, objekt_id: '' }));
      } else {
        const ob = await createObjekt({ naziv: quickForm.naziv.trim(), investitor_id: form.investitor_id });
        setForm((f) => ({ ...f, objekt_id: ob.id, adresa_radova: f.adresa_radova || quickForm.adresa.trim() }));
      }
      setQuick(null);
      onLookupsChanged();
    } catch (e) {
      setError(errText(e));
    }
  };
  const onObjekt = (id: string) => {
    const o = objekti.find((x) => x.id === id);
    setForm((f) => ({
      ...f, objekt_id: id,
      adresa_radova: f.adresa_radova || [o?.adresa, o?.mjesto].filter(Boolean).join(', '),
    }));
  };

  const save = async () => {
    if (!form.naslov.trim()) {
      setError('Upiši naslov ponude.');
      return;
    }
    if (lines.some((l) => !l.opis.trim())) {
      setError('Svaka stavka mora imati opis.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const resolved: Line[] = [];
      for (const l of lines) {
        if (!l.stavka_id && l.spremiUBazu) {
          const created = await createStavka({
            sifra: null, naziv: l.opis.trim().split('\n')[0].slice(0, 80), vrsta_posla: l.vrsta.trim() || null, podgrupa: l.podgrupa.trim() || null,
            jedinica: l.jedinica, cijena: pn(l.cijena), opis: l.opis.trim(),
          });
          resolved.push({ ...l, stavka_id: created.id });
        } else resolved.push(l);
      }
      const base = {
        naslov: form.naslov.trim(), investitor_id: form.investitor_id || null, objekt_id: form.objekt_id || null,
        adresa_radova: form.adresa_radova.trim() || null, datum: form.datum, status: form.status,
        popust: pn(form.popust), pdv: form.prijenos ? 0 : pn(form.pdv), napomene: form.napomene.trim() || null,
        prikazi_popust: form.prikazi_popust, prijenos_porezne_obveze: form.prijenos,
      };
      let id = ponuda?.id;
      if (id) await updatePonuda(id, base);
      else id = (await createPonuda(base)).id;
      await replacePonudaStavke(id, resolved.map((l, i) => ({
        stavka_id: l.stavka_id, redoslijed: i, opis: l.opis.trim(), jedinica: l.jedinica,
        vrsta_posla: l.vrsta.trim() || null, podgrupa: l.podgrupa.trim() || null,
        kolicina: pn(l.kolicina), cijena: pn(l.cijena), popust: pn(l.popust),
      })));
      if (resolved.some((l, i) => l.stavka_id !== lines[i].stavka_id)) onBazaChanged();
      onSaved();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const pdf = () => {
    const full: Ponuda = {
      ...(ponuda ?? { id: '', godina: new Date(form.datum).getFullYear(), redni_broj: 0, gradiliste_id: null, created_at: '' }),
      naslov: form.naslov, investitor_id: form.investitor_id || null, objekt_id: form.objekt_id || null,
      adresa_radova: form.adresa_radova, datum: form.datum, status: form.status, popust: pn(form.popust), pdv: form.prijenos ? 0 : pn(form.pdv),
      prikazi_popust: form.prikazi_popust, prijenos_porezne_obveze: form.prijenos,
      napomene: form.napomene, investitori: investitori.find((i) => i.id === form.investitor_id) ?? null,
    };
    setPdfBusy(true);
    exportPonudaPdf(full, asStavke, loadPonudaPostavke(), objekti.find((o) => o.id === form.objekt_id)?.adresa)
      .catch((e) => setError(errText(e)))
      .finally(() => setPdfBusy(false));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={ponuda ? `Ponuda ${ponudaBroj(ponuda)}` : 'Nova ponuda'}
      footer={(
        <>
          <button type="button" onClick={pdf} disabled={pdfBusy} className="mr-auto inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {pdfBusy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" /> : <FileDown className="h-4 w-4" />}
            {pdfBusy ? 'Izrada PDF-a…' : 'PDF'}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Odustani</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
            {saving ? 'Spremanje…' : 'Spremi ponudu'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-4">
          <div className="min-w-0 xl:col-span-2"><Field label="Naslov (npr. Fasaderski radovi) *"><TextInput value={form.naslov} onChange={(e) => setForm({ ...form, naslov: e.target.value })} /></Field></div>
          <Field label="Datum"><TextInput type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PonudaStatus })}>
              {Object.entries(statusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Investitor">
            <div className="flex min-w-0 gap-1">
              <Select className="min-w-0" value={form.investitor_id} onChange={(e) => onInvestitor(e.target.value)}>
                <option value="">—</option>
                {investitori.map((i) => <option key={i.id} value={i.id}>{i.naziv}</option>)}
              </Select>
              <button type="button" title="Novi investitor" onClick={() => openQuick('investitor')} className="flex-shrink-0 rounded-lg border border-slate-200 px-2.5 text-lg leading-none text-sky-600 hover:bg-sky-50">+</button>
            </div>
          </Field>
          <Field label="Objekt">
            <div className="flex min-w-0 gap-1">
              <Select className="min-w-0" value={form.objekt_id} onChange={(e) => onObjekt(e.target.value)}>
                <option value="">—</option>
                {objektiInv.map((o) => <option key={o.id} value={o.id}>{o.naziv}</option>)}
              </Select>
              <button type="button" title="Novi objekt" onClick={() => openQuick('objekt')} className="flex-shrink-0 rounded-lg border border-slate-200 px-2.5 text-lg leading-none text-sky-600 hover:bg-sky-50">+</button>
            </div>
          </Field>
          <div className="min-w-0 xl:col-span-2"><Field label="Adresa izvođenja radova"><TextInput value={form.adresa_radova} onChange={(e) => setForm({ ...form, adresa_radova: e.target.value })} /></Field></div>
          {quick && (
            <div className="min-w-0 rounded-xl border border-sky-200 bg-sky-50 p-3 xl:col-span-2 2xl:col-span-4">
              <p className="mb-2 text-sm font-semibold text-slate-700">
                {quick === 'investitor' ? 'Novi investitor' : `Novi objekt za: ${investitori.find((i) => i.id === form.investitor_id)?.naziv ?? ''}`}
              </p>
              <div className="grid gap-2 xl:grid-cols-2 2xl:grid-cols-4">
                <Field label="Naziv *"><TextInput value={quickForm.naziv} onChange={(e) => setQuickForm({ ...quickForm, naziv: e.target.value })} /></Field>
                {quick === 'investitor' && <Field label="OIB"><TextInput value={quickForm.oib} onChange={(e) => setQuickForm({ ...quickForm, oib: e.target.value })} /></Field>}
                <Field label="Adresa"><TextInput value={quickForm.adresa} onChange={(e) => setQuickForm({ ...quickForm, adresa: e.target.value })} /></Field>
                {quick === 'investitor' && <Field label="Mjesto"><TextInput value={quickForm.mjesto} onChange={(e) => setQuickForm({ ...quickForm, mjesto: e.target.value })} /></Field>}
              </div>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setQuick(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-white">Odustani</button>
                <button type="button" onClick={() => void saveQuick()} disabled={!quickForm.naziv.trim()} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">Dodaj</button>
              </div>
            </div>
          )}
          <Field label="Opći popust (%)"><TextInput type="number" min="0" max="100" disabled={!form.prikazi_popust} value={form.popust} onChange={(e) => setForm({ ...form, popust: e.target.value })} /></Field>
          <Field label="PDV (%)"><TextInput type="number" min="0" disabled={form.prijenos} value={form.prijenos ? '0' : form.pdv} onChange={(e) => setForm({ ...form, pdv: e.target.value })} /></Field>
          <div className="flex min-w-0 flex-col justify-end gap-1 text-sm text-slate-700 xl:col-span-2">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.prikazi_popust} onChange={(e) => setForm({ ...form, prikazi_popust: e.target.checked })} />
              Prikaži rabat/popust na ponudi
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={form.prijenos} onChange={(e) => setForm({ ...form, prijenos: e.target.checked })} />
              Prijenos porezne obveze (bez PDV-a, s napomenom)
            </label>
          </div>
        </div>

        <div className="min-w-0 rounded-xl border border-slate-200">
          <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 p-3 xl:flex-row xl:flex-wrap xl:items-center">
            <div className="relative min-w-0 xl:min-w-64 xl:flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Dodaj stavku iz baze (naziv, šifra, vrsta posla)…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm" />
              {suggestions.length > 0 && (
                <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {suggestions.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => addFromBase(s)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-sky-50">
                        <ListPlus className="h-4 w-4 text-sky-600" />
                        <span className="min-w-0 flex-1 truncate">{s.naziv}</span>
                        <span className="text-xs text-slate-400">{s.vrsta_posla}</span>
                        <span className="text-xs font-semibold text-slate-700">{eur(s.cijena)}/{s.jedinica}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" onClick={addNew} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <FilePlus2 className="h-4 w-4" /> Nova stavka
            </button>
          </div>

          {lines.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">Još nema stavki. Pretraži bazu ili dodaj novu stavku.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="w-8 px-2 py-2">#</th>
                    <th className="px-2 py-2 text-left">Opis radova</th>
                    <th className="w-20 px-2 py-2">Jed.</th>
                    <th className="w-24 px-2 py-2">Količina</th>
                    <th className="w-24 px-2 py-2">Cijena €</th>
                    {form.prikazi_popust && <th className="w-20 px-2 py-2">Popust %</th>}
                    <th className="w-28 px-2 py-2 text-right">Iznos</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lines.map((l, i) => {
                    const pop = !form.prikazi_popust ? 0 : pn(l.popust) > 0 ? pn(l.popust) : pn(form.popust);
                    const iznos = pn(l.kolicina) * pn(l.cijena) * (1 - pop / 100);
                    const base = l.stavka_id ? bazaById.get(l.stavka_id) : undefined;
                    const priceDiffers = base && Number(base.cijena) !== pn(l.cijena);
                    return (
                      <tr key={l.key} className="align-top">
                        <td className="px-2 py-2 text-center text-slate-400">{i + 1}.</td>
                        <td className="px-2 py-2">
                          <Textarea rows={3} value={l.opis} onChange={(e) => patch(l.key, { opis: e.target.value })} />
                          <div className="mt-1">
                            <input value={l.vrsta} onChange={(e) => patch(l.key, { vrsta: e.target.value })} placeholder="Upiši naziv grupe radova (npr. Fasaderski radovi)" className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs" />
                            {vrste.filter((v) => v !== l.vrsta).length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {vrste.filter((v) => v !== l.vrsta).map((v) => (
                                  <button key={v} type="button" onClick={() => patch(l.key, { vrsta: v })} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-sky-100 hover:text-sky-700">{v}</button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                            {base ? <span>Iz baze: {base.naziv}</span> : (
                              <label className="inline-flex items-center gap-1.5">
                                <input type="checkbox" checked={l.spremiUBazu} onChange={(e) => patch(l.key, { spremiUBazu: e.target.checked })} />
                                Spremi i u bazu stavki
                              </label>
                            )}
                            {priceDiffers && (
                              <button type="button" onClick={() => void pushToBase(l)} className="inline-flex items-center gap-1 text-sky-600 hover:underline">
                                <ArrowUpFromLine className="h-3 w-3" /> Postavi ovu cijenu u bazu ({eur(base.cijena)})
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <Select value={l.jedinica} onChange={(e) => patch(l.key, { jedinica: e.target.value })}>
                            {[...new Set([...jedinice, l.jedinica])].map((j) => <option key={j} value={j}>{j}</option>)}
                          </Select>
                        </td>
                        <td className="px-2 py-2"><TextInput type="number" step="0.01" value={l.kolicina} onChange={(e) => patch(l.key, { kolicina: e.target.value })} /></td>
                        <td className="px-2 py-2"><TextInput type="number" step="0.01" value={l.cijena} onChange={(e) => patch(l.key, { cijena: e.target.value })} /></td>
                        {form.prikazi_popust && <td className="px-2 py-2"><TextInput type="number" min="0" max="100" value={l.popust} placeholder={form.popust} onChange={(e) => patch(l.key, { popust: e.target.value })} /></td>}
                        <td className="px-2 py-2 text-right font-medium text-slate-800">{eur(iznos)}</td>
                        <td className="px-2 py-2"><button type="button" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-slate-200 bg-slate-50 p-3 text-sm xl:ml-auto xl:w-96">
            <div className="flex min-w-0 items-baseline justify-between gap-x-6"><span className="text-slate-500">Vrijednost radova</span><span className="shrink-0 text-right">{eur(tot.vrijednost)}</span></div>
            {form.prikazi_popust && <><div className="flex min-w-0 items-baseline justify-between gap-x-6"><span className="text-slate-500">Popust</span><span className="shrink-0 text-right text-red-600">− {eur(tot.popust)}</span></div></>}
            <div className="flex min-w-0 items-baseline justify-between gap-x-6"><span className="font-semibold text-slate-700">Za platiti</span><span className="shrink-0 text-right font-semibold">{eur(tot.neto)}</span></div>
            <div className="flex min-w-0 items-baseline justify-between gap-x-6"><span className="text-slate-500">{form.prijenos ? 'PDV' : `PDV ${pn(form.pdv)}%`}</span><span className="shrink-0 text-right">{form.prijenos ? 'prijenos porezne obveze' : eur(tot.pdv)}</span></div>
            <div className="flex min-w-0 items-baseline justify-between gap-x-6"><span className="font-bold text-slate-900">Ukupno s PDV-om</span><span className="shrink-0 text-right font-bold text-slate-900">{eur(tot.bruto)}</span></div>
          </div>
        </div>

        <Field label="Napomene na ponudi (svaki red je zaseban odlomak)">
          <Textarea rows={5} value={form.napomene} onChange={(e) => setForm({ ...form, napomene: e.target.value })} />
        </Field>
        {ponuda?.gradiliste_id && <p className="flex items-center gap-1.5 text-xs text-emerald-700"><Building2 className="h-4 w-4" /> Ponuda je pretvorena u gradilište.</p>}
      </div>
    </Modal>
  );
}

// Pretvorba potvrđene ponude u planirano gradilište
export async function convertToGradiliste(p: Ponuda, stavke: PonudaStavka[], objekti: Objekt[]) {
  const tot = ponudaUkupno(p, stavke);
  const objekt = objekti.find((o) => o.id === p.objekt_id);
  const g = await createGradiliste({
    naziv: p.adresa_radova ? `${p.naslov} – ${p.adresa_radova}` : p.naslov,
    adresa: p.adresa_radova ?? objekt?.adresa ?? null,
    regija: null,
    objekt_id: p.objekt_id,
    voditelj_gradilista: null,
    ugovorena_vrijednost: Math.round(tot.neto * 100) / 100,
    predvidena_marza: null,
    status: 'planirano',
    datum_pocetka: null,
    datum_zavrsetka: null,
    opis: `Iz ponude ${ponudaBroj(p)}`,
  });
  await updatePonuda(p.id, { gradiliste_id: g.id });
  return g;
}
