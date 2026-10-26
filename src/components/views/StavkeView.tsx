import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ListChecks, Pencil, Plus, Search, Trash2, History, MapPin } from 'lucide-react';
import type { Gradiliste } from '@/types';
import { fetchGradilista } from '@/lib/api';
import {
  addStavkaNaGradiliste, createStavka, deleteStavka, fetchStavke, fetchStavkaKoristenje, fetchStavkaLog,
  fetchStavkeBrojKoristenja, fetchStavkaPonude, removeStavkaSGradilista, updateStavka,
  type GradilisteStavka, type Stavka, type StavkaCijenaLog, type StavkaPonudaUse,
} from '@/lib/stavke';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field, Select, Textarea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ExportMenu } from '@/components/ui/ExportMenu';

const emptyForm = { sifra: '', naziv: '', vrsta_posla: '', podgrupa: '', jedinica: 'm2', cijena: '', opis: '' };

const jedinice = ['m2', 'm', 'm3', 'kom', 'h', 'kg', 'l', 'paušal'];

const eur = (v: number) => v.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const dt = (v: string) => new Date(v).toLocaleDateString('hr-HR');

const errText = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : 'Greška');

function StavkaDetalji({ stavka, gradilista, onChanged }: { stavka: Stavka; gradilista: Gradiliste[]; onChanged: () => void }) {
  const [log, setLog] = useState<StavkaCijenaLog[]>([]);
  const [uses, setUses] = useState<GradilisteStavka[]>([]);
  const [ponudeUses, setPonudeUses] = useState<StavkaPonudaUse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ gradiliste_id: '', kolicina: '1', cijena: stavka.cijena.toString() });

  const load = async () => {
    try {
      const [l, u, p] = await Promise.all([fetchStavkaLog(stavka.id), fetchStavkaKoristenje(stavka.id), fetchStavkaPonude(stavka)]);
      setLog(l);
      setUses(u);
      setPonudeUses(p);
    } catch (e) {
      setError(errText(e));
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stavka.id, stavka.cijena]);

  const add = async () => {
    const kolicina = parseFloat(form.kolicina.replace(',', '.'));
    if (!form.gradiliste_id || !(kolicina > 0)) return;
    try {
      await addStavkaNaGradiliste({
        gradiliste_id: form.gradiliste_id,
        stavka_id: stavka.id,
        kolicina,
        cijena: parseFloat(form.cijena.replace(',', '.')) || 0,
        napomena: null,
      });
      setForm({ ...form, gradiliste_id: '', kolicina: '1' });
      await load();
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  };

  const remove = async (id: string) => {
    try {
      await removeStavkaSGradilista(id);
      await load();
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 border-t border-slate-100 bg-slate-50 p-4 xl:grid-cols-2">
      {error && <p className="rounded bg-red-50 p-2 text-xs text-red-700 xl:col-span-2">{error}</p>}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><History className="h-4 w-4" /> Povijest cijene</p>
        {stavka.opis && <p className="mb-2 text-xs text-slate-500">{stavka.opis}</p>}
        {log.length === 0 ? (
          <p className="text-xs text-slate-400">Cijena nije mijenjana od unosa ({eur(stavka.cijena)}).</p>
        ) : (
          <ul className="divide-y divide-slate-200 text-xs">
            {log.map((l) => (
              <li key={l.id} className="flex min-w-0 flex-wrap items-center gap-2 py-1.5">
                <span className="w-20 text-slate-400">{dt(l.created_at)}</span>
                <span className="text-slate-500">{l.stara_cijena != null ? eur(l.stara_cijena) : '—'} → <b className="text-slate-800">{eur(l.nova_cijena)}</b></span>
              </li>
            ))}
          </ul>
        )}
        <p className="mb-2 mt-4 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><ListChecks className="h-4 w-4" /> Korištena u ponudama ({ponudeUses.length})</p>
        {ponudeUses.length === 0 ? (
          <p className="text-xs text-slate-400">Još nije korištena ni u jednoj ponudi.</p>
        ) : (
          <ul className="divide-y divide-slate-200 text-xs">
            {ponudeUses.map((u) => (
              <li key={u.id} className="flex min-w-0 flex-wrap items-center gap-2 py-1.5">
                <span className="w-14 font-semibold text-slate-700">{u.ponude ? `${u.ponude.redni_broj}/${u.ponude.godina}` : '—'}</span>
                <span className="min-w-0 flex-1 truncate text-slate-600">{u.ponude?.naslov}</span>
                <span className="text-slate-500">{u.kolicina} {u.jedinica} × <b className="text-slate-800">{eur(u.cijena)}</b></span>
                <span className="text-slate-400">{u.ponude ? dt(u.ponude.datum) : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><MapPin className="h-4 w-4" /> Gdje je korištena ({uses.length})</p>
        <div className="mb-2 grid min-w-0 grid-cols-1 items-center gap-2 xl:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_4.5rem_5.5rem_auto]">
          <Select value={form.gradiliste_id} onChange={(e) => setForm({ ...form, gradiliste_id: e.target.value })}>
            <option value="">Gradilište…</option>
            {gradilista.map((g) => <option key={g.id} value={g.id}>{g.naziv}</option>)}
          </Select>
          <TextInput value={form.kolicina} onChange={(e) => setForm({ ...form, kolicina: e.target.value })} placeholder="Kol." />
          <TextInput value={form.cijena} onChange={(e) => setForm({ ...form, cijena: e.target.value })} placeholder="Cijena" />
          <button type="button" onClick={() => void add()} className="rounded-lg bg-sky-600 p-2 text-white hover:bg-sky-700"><Plus className="h-4 w-4" /></button>
        </div>
        {uses.length === 0 ? (
          <p className="text-xs text-slate-400">Još nije dodana ni na jedno gradilište.</p>
        ) : (
          <ul className="divide-y divide-slate-200 text-xs">
            {uses.map((u) => (
              <li key={u.id} className="flex min-w-0 flex-wrap items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 break-words font-medium text-slate-700">{u.gradilista?.naziv ?? 'Gradilište'}</span>
                <span className="text-slate-500">{u.kolicina} {stavka.jedinica} × {eur(u.cijena)} = <b className="text-slate-800">{eur(u.kolicina * u.cijena)}</b></span>
                <span className="text-slate-400">{dt(u.created_at)}</span>
                <button type="button" onClick={() => void remove(u.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function StavkeView() {
  const [items, setItems] = useState<Stavka[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [query, setQuery] = useState('');
  const [vrsta, setVrsta] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Stavka | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Stavka | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [s, g] = await Promise.all([fetchStavke(), fetchGradilista()]);
      const c = await fetchStavkeBrojKoristenja(s);
      setItems(s);
      setGradilista(g);
      setCounts(c);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const vrste = useMemo(() => [...new Set(items.map((i) => i.vrsta_posla).filter((v): v is string => !!v))].sort(), [items]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, Stavka[]>();
    items
      .filter((s) => (!vrsta || s.vrsta_posla === vrsta) && (!q || [s.naziv, s.sifra, s.vrsta_posla, s.opis].some((v) => (v ?? '').toLowerCase().includes(q))))
      .forEach((s) => {
        const key = s.vrsta_posla || 'Bez vrste';
        map.set(key, [...(map.get(key) ?? []), s]);
      });
    return [...map.entries()];
  }, [items, query, vrsta]);

  const openForm = (s?: Stavka) => {
    setEditing(s ?? null);
    setForm(s ? { sifra: s.sifra ?? '', naziv: s.naziv, vrsta_posla: s.vrsta_posla ?? '', podgrupa: s.podgrupa ?? '', jedinica: s.jedinica, cijena: s.cijena.toString(), opis: s.opis ?? '' } : emptyForm);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.naziv.trim()) return;
    setSaving(true);
    try {
      const payload = {
        sifra: form.sifra.trim() || null,
        naziv: form.naziv.trim(),
        vrsta_posla: form.vrsta_posla.trim() || null,
        podgrupa: form.podgrupa.trim() || null,
        jedinica: form.jedinica,
        cijena: parseFloat(form.cijena.replace(',', '.')) || 0,
        opis: form.opis.trim() || null,
      };
      if (editing) await updateStavka(editing.id, payload, editing.cijena);
      else await createStavka(payload);
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await deleteStavka(deleteTarget.id);
      await load();
    } catch (e) {
      setError(errText(e));
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;

  return (
    <div className="min-w-0 max-w-full break-words">
      <div className="mb-6 flex min-w-0 flex-col items-stretch justify-between gap-3 xl:flex-row xl:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Troškovničke stavke</h1>
          <p className="mt-1 text-sm text-slate-500">Baza stavki po vrstama poslova za izradu ponuda</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-wrap">
          <ExportMenu
            disabled={grouped.length === 0}
            build={() => ({
              file: 'Stavke',
              title: 'Troškovničke stavke',
              rows: grouped.flatMap(([, list]) => list),
              columns: [
                { header: 'Vrsta posla', get: (s: Stavka) => s.vrsta_posla ?? '' },
                { header: 'Šifra', get: (s: Stavka) => s.sifra ?? '' },
                { header: 'Naziv', get: (s: Stavka) => s.naziv },
                { header: 'Jedinica', get: (s: Stavka) => s.jedinica },
                { header: 'Cijena', kind: 'eur', get: (s: Stavka) => s.cijena },
                { header: 'Zadnja promjena cijene', kind: 'date', get: (s: Stavka) => s.cijena_promijenjena_at },
                { header: 'Opis', get: (s: Stavka) => s.opis ?? '' },
              ],
            })}
          />
          <button onClick={() => openForm()} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-700">
            <Plus className="h-4 w-4" /> Nova stavka
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mb-4 flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-wrap">
        <div className="relative min-w-0 xl:min-w-60 xl:flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Traži stavku, šifru, vrstu posla…" className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm" />
        </div>
        <select value={vrsta} onChange={(e) => setVrsta(e.target.value)} className="min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <option value="">Sve vrste poslova</option>
          {vrste.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<ListChecks className="h-7 w-7" />} title="Nema stavki" description="Dodajte stavke s jedinicom mjere i cijenom; kasnije će služiti za ponude." />
      ) : (
        <div className="space-y-5">
          {grouped.map(([group, list]) => (
            <div key={group}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group} ({list.length})</h2>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {list.map((s) => {
                  const open = expanded === s.id;
                  return (
                    <div key={s.id} className="border-b border-slate-100 last:border-0">
                      <div className="group flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
                        <button type="button" onClick={() => setExpanded(open ? null : s.id)} className="flex min-w-0 w-full flex-col items-start gap-3 text-left xl:w-auto xl:flex-1 xl:flex-row xl:items-center">
                          {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                          {s.sifra && <span className="min-w-0 max-w-full text-xs font-medium text-slate-400 xl:w-20">{s.sifra}</span>}
                          <span className="min-w-0 flex-1 break-words font-medium text-slate-900">{s.naziv}</span>
                          <span className="text-xs text-slate-400">{counts.get(s.id) ?? 0}× korištena</span>
                          <span className="max-w-full text-sm font-semibold text-slate-800 xl:w-36 xl:text-right">{eur(s.cijena)} / {s.jedinica}</span>
                          <span className="max-w-full text-xs text-slate-400 xl:w-28 xl:text-right">{s.cijena_promijenjena_at ? `izmj. ${dt(s.cijena_promijenjena_at)}` : '—'}</span>
                        </button>
                        <div className="flex gap-1 opacity-100 transition-opacity group-hover:opacity-100 xl:opacity-0">
                          <button onClick={() => openForm(s)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => setDeleteTarget(s)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                      {open && <StavkaDetalji stavka={s} gradilista={gradilista} onChanged={() => void fetchStavkeBrojKoristenja(items).then(setCounts)} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi stavku' : 'Nova stavka'}
        footer={(
          <>
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Odustani</button>
            <button type="button" onClick={() => void save()} disabled={saving || !form.naziv.trim()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[8rem_minmax(0,1fr)]">
            <Field label="Šifra"><TextInput value={form.sifra} onChange={(e) => setForm({ ...form, sifra: e.target.value })} /></Field>
            <Field label="Naziv stavke *"><TextInput value={form.naziv} onChange={(e) => setForm({ ...form, naziv: e.target.value })} /></Field>
          </div>
          <Field label="Vrsta posla">
            <TextInput list="vrste-poslova" value={form.vrsta_posla} onChange={(e) => setForm({ ...form, vrsta_posla: e.target.value })} placeholder="npr. Gletanje, Bojanje, Fasada" />
            <datalist id="vrste-poslova">{vrste.map((v) => <option key={v} value={v} />)}</datalist>
          </Field>
          <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
            <Field label="Jedinica mjere">
              <Select value={form.jedinica} onChange={(e) => setForm({ ...form, jedinica: e.target.value })}>
                {jedinice.map((j) => <option key={j} value={j}>{j}</option>)}
              </Select>
            </Field>
            <Field label="Cijena (EUR)"><TextInput type="number" step="0.01" min="0" value={form.cijena} onChange={(e) => setForm({ ...form, cijena: e.target.value })} /></Field>
          </div>
          <Field label="Opis"><Textarea value={form.opis} onChange={(e) => setForm({ ...form, opis: e.target.value })} rows={3} /></Field>
          {editing && <p className="text-xs text-slate-400">Promjena cijene automatski se bilježi u povijest.</p>}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Izbrisati stavku?"
        message="Briše se i povijest cijene te veze s gradilištima."
      />
    </div>
  );
}
