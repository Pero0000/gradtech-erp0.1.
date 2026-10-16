import { useState, useEffect } from 'react';
import { ClipboardList, Plus, Pencil, Trash2, Users, Calendar, AlertCircle, Printer, Bell } from 'lucide-react';
import type { RadniNalog, Gradiliste, Radnik, NalogStatus, NalogPrioritet, Rok } from '@/types';
import {
  fetchRokoviNaloga,
  createRok,
  updateRok,
  deleteRok,
  fetchRadniNalozi,
  createRadniNalog,
  updateRadniNalog,
  deleteRadniNalog,
  notifyLockedNalogWorkers,
  fetchGradilista,
  fetchRadnici,
} from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { NalogIzvrsenje } from './NalogIzvrsenje';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { downloadNalogPdf } from '@/lib/nalogPdf';

const statusInfo: Record<NalogStatus, { variant: 'blue' | 'yellow' | 'green' | 'red'; label: string }> = {
  otvoren: { variant: 'blue', label: 'Otvoren' },
  u_tijeku: { variant: 'yellow', label: 'U tijeku' },
  zavrsen: { variant: 'green', label: 'Završen' },
  otkazan: { variant: 'red', label: 'Otkazan' },
};

const prioritetInfo: Record<NalogPrioritet, { variant: 'gray' | 'blue' | 'orange' | 'red'; label: string }> = {
  niski: { variant: 'gray', label: 'Niski' },
  srednji: { variant: 'blue', label: 'Srednji' },
  visoki: { variant: 'orange', label: 'Visoki' },
  hitno: { variant: 'red', label: 'Hitno' },
};

const emptyForm = {
  broj: '',
  gradiliste_id: '',
  naslov: '',
  opis: '',
  status: 'otvoren' as NalogStatus,
  prioritet: 'srednji' as NalogPrioritet,
  rok: '',
  radnik_ids: [] as string[],
};

type Period = 'svi' | 'danas' | 'sutra' | 'tjedan' | 'prosli' | 'kasni' | 'datum' | 'bez';

const periodOptions: { key: Period; label: string }[] = [
  { key: 'danas', label: 'Danas' },
  { key: 'sutra', label: 'Sutra' },
  { key: 'tjedan', label: 'Ovaj tjedan' },
  { key: 'prosli', label: 'Prošli tjedan' },
  { key: 'kasni', label: 'Kasni' },
  { key: 'datum', label: 'Odaberi datum' },
  { key: 'bez', label: 'Bez roka' },
  { key: 'svi', label: 'Svi' },
];

const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (d: Date, n: number) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

const fmtDate = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('hr-HR');

export function RadniNaloziView({ focusNalogId }: { focusNalogId?: string | null } = {}) {
  const [items, setItems] = useState<RadniNalog[]>([]);
  const [gradilista, setGradilista] = useState<Gradiliste[]>([]);
  const [radnici, setRadnici] = useState<Radnik[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RadniNalog | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>(focusNalogId ? 'svi' : 'danas');
  const [customDate, setCustomDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<NalogStatus | 'svi'>('svi');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(focusNalogId ?? null);
  const [rokovi, setRokovi] = useState<Rok[]>([]);
  const [rokForm, setRokForm] = useState({ naziv: '', datum: '', opis: '' });
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);

  const printNalog = async (n: RadniNalog) => {
    setPrintingId(n.id);
    try {
      await downloadNalogPdf(n, gradilista.find((g) => g.id === n.gradiliste_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri izradi PDF-a');
    } finally {
      setPrintingId(null);
    }
  };

  const notifyWorkers = async (n: RadniNalog) => {
    setNotifyingId(n.id);
    setError(null);
    try {
      await notifyLockedNalogWorkers(n.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Push obavijest nije poslana.');
    } finally {
      setNotifyingId(null);
    }
  };

  const loadRokovi = async () => {
    try {
      setRokovi(await fetchRokoviNaloga());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri učitavanju rokova');
    }
  };

  const addRok = async (n: RadniNalog) => {
    if (!rokForm.naziv.trim() || !rokForm.datum) return;
    try {
      await createRok({
        gradiliste_id: n.gradiliste_id ?? null,
        nalog_id: n.id,
        naziv: rokForm.naziv.trim(),
        datum: rokForm.datum,
        status: 'otvoren',
        opis: rokForm.opis.trim() || null,
      });
      setRokForm({ naziv: '', datum: '', opis: '' });
      await loadRokovi();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri spremanju roka');
    }
  };

  const toggleRok = async (r: Rok) => {
    try {
      await updateRok(r.id, { status: r.status === 'zavrsen' ? 'otvoren' : 'zavrsen' });
      await loadRokovi();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri spremanju roka');
    }
  };

  const removeRok = async (id: string) => {
    try {
      await deleteRok(id);
      await loadRokovi();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju roka');
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [n, g, r] = await Promise.all([fetchRadniNalozi(), fetchGradilista(), fetchRadnici()]);
      setItems(n);
      setGradilista(g);
      setRadnici(r);
      await loadRokovi();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openEdit = (n: RadniNalog) => {
    setEditing(n);
    setForm({
      broj: n.broj,
      gradiliste_id: n.gradiliste_id ?? '',
      naslov: n.naslov,
      opis: n.opis ?? '',
      status: n.status,
      prioritet: n.prioritet,
      rok: n.rok ?? '',
      radnik_ids: (n.radnici ?? []).map((r) => r.id),
    });
    setModalOpen(true);
  };

  const toggleRadnik = (id: string) => {
    setForm((f) => ({
      ...f,
      radnik_ids: f.radnik_ids.includes(id)
        ? f.radnik_ids.filter((r) => r !== id)
        : [...f.radnik_ids, id],
    }));
  };

  const save = async () => {
    if (!form.naslov.trim()) return;
    setSaving(true);
    try {
      const payload = {
        gradiliste_id: form.gradiliste_id || null,
        naslov: form.naslov.trim(),
        opis: form.opis.trim() || null,
        status: form.status,
        prioritet: form.prioritet,
        rok: form.rok || null,
        radnik_ids: form.radnik_ids,
      };
      if (editing) {
        await updateRadniNalog(editing.id, payload);
      } else {
        await createRadniNalog({ ...payload, broj: form.broj });
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri spremanju');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteRadniNalog(deleteId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju');
    }
  };

  const filteredItems = items.filter((n) => {
    if (statusFilter !== 'svi' && n.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (q && !`${n.broj} ${n.naslov} ${n.gradilista?.naziv ?? ''}`.toLowerCase().includes(q)) return false;
    if (period === 'svi') return true;
    if (period === 'bez') return !n.rok;
    if (!n.rok) return false;
    const today = new Date();
    const todayStr = toISO(today);
    switch (period) {
      case 'danas':
        return n.rok === todayStr;
      case 'sutra':
        return n.rok === toISO(addDays(today, 1));
      case 'tjedan': {
        const start = addDays(today, -((today.getDay() + 6) % 7));
        return n.rok >= toISO(start) && n.rok <= toISO(addDays(start, 6));
      }
      case 'prosli': {
        const start = addDays(today, -((today.getDay() + 6) % 7) - 7);
        return n.rok >= toISO(start) && n.rok <= toISO(addDays(start, 6));
      }
      case 'kasni':
        return n.rok < todayStr && n.status !== 'zavrsen' && n.status !== 'otkazan';
      case 'datum':
        return !customDate || n.rok === customDate;
      default:
        return true;
    }
  });

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  const selected = filteredItems.find((n) => n.id === selectedId) ?? filteredItems[0] ?? null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Radni nalozi</h1>
          <p className="text-sm text-slate-500 mt-1">Pregled i praćenje radnih naloga. Novi nalozi kreiraju se u Dnevnom rasporedu.</p>
        </div>
        <ExportMenu
          disabled={filteredItems.length === 0}
          build={() => ({
            file: 'Radni_nalozi',
            title: 'Radni nalozi',
            rows: filteredItems,
            columns: [
              { header: 'Broj', get: (n: RadniNalog) => n.broj },
              { header: 'Naslov', get: (n: RadniNalog) => n.naslov },
              { header: 'Gradilište', get: (n: RadniNalog) => n.gradilista?.naziv ?? '' },
              { header: 'Status', get: (n: RadniNalog) => statusInfo[n.status].label },
              { header: 'Prioritet', get: (n: RadniNalog) => prioritetInfo[n.prioritet].label },
              { header: 'Rok', kind: 'date', get: (n: RadniNalog) => n.rok },
              { header: 'Radnici', get: (n: RadniNalog) => (n.radnici ?? []).map((r) => `${r.ime} ${r.prezime}`).join(', ') },
              { header: 'Opis', get: (n: RadniNalog) => n.opis ?? '' },
            ],
          })}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-7 w-7" />}
          title="Nema radnih naloga"
          description="Radni nalozi kreiraju se u Dnevnom rasporedu klikom na RN uz gradilište."
        />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
            {periodOptions.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  period === p.key ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
            {period === 'datum' && (
              <input
                type="date"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
            )}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as NalogStatus | 'svi')}
              className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-xs"
            >
              <option value="svi">Svi statusi</option>
              {(Object.keys(statusInfo) as NalogStatus[]).map((s) => (
                <option key={s} value={s}>{statusInfo[s].label}</option>
              ))}
            </select>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Traži broj, naslov, gradilište…"
              className="w-56 rounded-lg border border-slate-300 px-2 py-1 text-xs"
            />
            <span className="text-xs text-slate-400">{filteredItems.length} / {items.length}</span>
          </div>
          {filteredItems.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">Nema naloga za odabrani filter.</p>
          )}
          {filteredItems.length > 0 && (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(380px,0.75fr)_minmax(0,1.6fr)]">
          <div className="space-y-2">
            {filteredItems.map((n) => {
              const nextRok = rokovi.filter((r) => r.nalog_id === n.id && r.status === 'otvoren')[0];
              const active = selected?.id === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${
                    active ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-slate-400">{n.broj}</span>
                    <Badge variant={statusInfo[n.status].variant}>{statusInfo[n.status].label}</Badge>
                  </div>
                  {n.mobile_status && n.mobile_status !== 'nije_poslan' && (
                    <p className={`mt-1 text-xs font-semibold ${n.mobile_status === 'predan' ? 'text-amber-700' : n.mobile_status === 'odobren' ? 'text-emerald-700' : 'text-sky-700'}`}>
                      Mobitel: {{ dodijeljen: 'Djelatniku dodijeljen', u_tijeku: 'Djelatnik radi', predan: 'Čeka tvoje odobrenje', odobren: 'Djelatniku odobreno', nije_poslan: '' }[n.mobile_status]}
                    </p>
                  )}
                  <p className="mt-1 text-sm font-semibold text-slate-900">{n.naslov}</p>
                  {n.gradilista?.naziv && <p className="text-xs text-slate-500">{n.gradilista.naziv}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-slate-500">
                    {n.rok && <span>Rok: {fmtDate(n.rok)}</span>}
                    {nextRok && <span className="text-amber-700">Sljedeći: {nextRok.naziv} · {fmtDate(nextRok.datum)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
          <div>
          {selected && (() => {
            const n = selected;
            const si = statusInfo[n.status];
            const pi = prioritetInfo[n.prioritet];
            const nalogRokovi = rokovi.filter((r) => r.nalog_id === n.id);
            return (
              <div
                key={n.id}
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                      <ClipboardList className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium text-slate-400">{n.broj}</span>
                        <h3 className="font-semibold text-slate-900">{n.naslov}</h3>
                      </div>
                      {n.gradilista?.naziv && (
                        <p className="text-sm text-slate-500 mt-0.5">{n.gradilista.naziv}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div id={`rn-detail-slot-${n.id}`} className="mr-2" />
                    <button
                      onClick={() => printNalog(n)}
                      disabled={printingId === n.id}
                      title="Preuzmi nalog za ispis (PDF)"
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-sky-600 transition-colors disabled:opacity-50"
                    >
                      <Printer className="h-4 w-4" />
                      {printingId === n.id ? 'Priprema…' : 'PDF za ispis'}
                    </button>
                    {n.mobile_status === 'dodijeljen' && (
                      <button
                        onClick={() => void notifyWorkers(n)}
                        disabled={notifyingId === n.id}
                        title="Ponovno pošalji push obavijest dodijeljenim djelatnicima"
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                      >
                        <Bell className="h-4 w-4" />
                        {notifyingId === n.id ? 'Šaljem…' : 'Pošalji push'}
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(n)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteId(n.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {n.opis && <p className="text-sm text-slate-600 mb-3">{n.opis}</p>}

                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={si.variant}>{si.label}</Badge>
                  <Badge variant={pi.variant}>{pi.label}</Badge>
                  {n.mobile_status === 'predan' && <Badge variant="orange">Čeka odobrenje djelatnikova izvještaja</Badge>}
                  {(n.radnici ?? []).length > 0 && (
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Users className="h-3.5 w-3.5" />
                      {(n.radnici ?? []).map((r) => `${r.ime} ${r.prezime}${r.id === n.poslovodja_id ? ' (poslovođa)' : ''}`).join(', ')}
                    </span>
                  )}
                  {n.rok && (
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Calendar className="h-3.5 w-3.5" />
                      Rok: {new Date(n.rok + 'T00:00:00').toLocaleDateString('hr-HR')}
                    </span>
                  )}
                </div>

                <div className="mt-5 border-t border-slate-100 pt-4">
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Calendar className="h-4 w-4 text-sky-600" />
                    Rokovi i važni datumi ({nalogRokovi.length})
                  </h4>
                  {nalogRokovi.length === 0 && <p className="mb-3 text-xs text-slate-400">Nema dodanih rokova.</p>}
                  <div className="mb-3 space-y-1.5">
                    {nalogRokovi.map((r) => {
                      const late = r.status === 'otvoren' && r.datum < toISO(new Date());
                      return (
                        <div key={r.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={r.status === 'zavrsen'}
                            onChange={() => void toggleRok(r)}
                            className="h-4 w-4 rounded border-slate-300"
                            title="Označi kao završeno"
                          />
                          <div className="min-w-0 flex-1">
                            <p className={r.status === 'zavrsen' ? 'text-slate-400 line-through' : 'text-slate-800'}>{r.naziv}</p>
                            {r.opis && <p className="text-xs text-slate-500">{r.opis}</p>}
                          </div>
                          <span className={`flex-shrink-0 text-xs font-medium ${late ? 'text-red-600' : 'text-slate-600'}`}>
                            {fmtDate(r.datum)}{late ? ' · kasni' : ''}
                          </span>
                          <button
                            onClick={() => void removeRok(r.id)}
                            className="flex-shrink-0 text-slate-300 hover:text-red-600"
                            aria-label="Obriši rok"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={rokForm.naziv}
                      onChange={(e) => setRokForm((f) => ({ ...f, naziv: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') void addRok(n); }}
                      placeholder="Naziv roka ili važnog datuma"
                      className="min-w-[200px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    />
                    <input
                      type="date"
                      value={rokForm.datum}
                      onChange={(e) => setRokForm((f) => ({ ...f, datum: e.target.value }))}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <input
                      value={rokForm.opis}
                      onChange={(e) => setRokForm((f) => ({ ...f, opis: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') void addRok(n); }}
                      placeholder="Napomena (neobavezno)"
                      className="min-w-[160px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                    />
                    <button
                      onClick={() => void addRok(n)}
                      disabled={!rokForm.naziv.trim() || !rokForm.datum}
                      className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      Dodaj
                    </button>
                  </div>
                </div>

                <NalogIzvrsenje key={n.id} nalog={n} slotId={`rn-detail-slot-${n.id}`} onChange={() => void load()} />
              </div>
            );
          })()}
          </div>
          </div>
          )}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi radni nalog' : 'Novi radni nalog'}
        wide
        headerSlotId="nalog-modal-slot"
        footer={
          <>
            <button
              onClick={() => setModalOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Odustani
            </button>
            <button
              onClick={save}
              disabled={saving || !form.naslov.trim()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-4">
          {!editing && (
            <Field label="Broj naloga">
              <TextInput value={form.broj} readOnly className="font-mono bg-slate-50" />
            </Field>
          )}
          <Field label="Naslov *">
            <TextInput
              value={form.naslov}
              onChange={(e) => setForm({ ...form, naslov: e.target.value })}
              placeholder="npr. Ugradnja armature 1. kat"
            />
          </Field>
          <Field label="Gradilište">
            <Select
              value={form.gradiliste_id}
              onChange={(e) => setForm({ ...form, gradiliste_id: e.target.value })}
            >
              <option value="">— Odaberi —</option>
              {gradilista.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.naziv}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Opis">
            <Textarea
              rows={3}
              value={form.opis}
              onChange={(e) => setForm({ ...form, opis: e.target.value })}
              placeholder="Detaljan opis zadatka…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as NalogStatus })}
              >
                <option value="otvoren">Otvoren</option>
                <option value="u_tijeku">U tijeku</option>
                <option value="zavrsen">Završen</option>
                <option value="otkazan">Otkazan</option>
              </Select>
            </Field>
            <Field label="Prioritet">
              <Select
                value={form.prioritet}
                onChange={(e) => setForm({ ...form, prioritet: e.target.value as NalogPrioritet })}
              >
                <option value="niski">Niski</option>
                <option value="srednji">Srednji</option>
                <option value="visoki">Visoki</option>
                <option value="hitno">Hitno</option>
              </Select>
            </Field>
          </div>
          <Field label="Rok izvršenja">
            <TextInput
              type="date"
              value={form.rok}
              onChange={(e) => setForm({ ...form, rok: e.target.value })}
            />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Dodijeljeni radnici</p>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {radnici.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400">
                  <AlertCircle className="h-4 w-4" />
                  Nema radnika. Dodajte radnike prvo.
                </div>
              ) : (
                radnici.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={form.radnik_ids.includes(r.id)}
                      onChange={() => toggleRadnik(r.id)}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-sm text-slate-700">
                      {r.ime} {r.prezime} <span className="text-slate-400">— {r.uloga}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
        {editing && (
          <div className="md:col-span-2 xl:col-span-3">
            <NalogIzvrsenje
              key={editing.id}
              nalog={editing}
              slotId="nalog-modal-slot"
              radnikIds={form.radnik_ids}
              onChange={(zavrsen) => setForm((f) => ({ ...f, status: zavrsen ? 'zavrsen' : f.status === 'zavrsen' ? 'u_tijeku' : f.status }))}
            />
          </div>
        )}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Izbrisati radni nalog?"
        message="Ova radnja je nepovratna."
      />
    </div>
  );
}
