import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Handshake, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { Kooperant, Trosak } from '@/types';
import { createKooperant, deleteKooperant, fetchKooperanti, fetchTroskovi, updateKooperant } from '@/lib/api';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field, Textarea, TextInput } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { ExportMenu } from '@/components/ui/ExportMenu';

const emptyForm = {
  naziv: '',
  djelatnost: '',
  oib: '',
  iban: '',
  adresa: '',
  mjesto: '',
  postanski_broj: '',
  kontakt_osoba: '',
  telefon: '',
  email: '',
  web: '',
  napomena: '',
};

const eur = (value: number) => value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });

function errorMessage(reason: unknown) {
  if (typeof reason === 'object' && reason !== null && 'message' in reason && typeof reason.message === 'string') return reason.message;
  return 'Došlo je do greške.';
}

export function KooperantiView() {
  const [items, setItems] = useState<Kooperant[]>([]);
  const [troskovi, setTroskovi] = useState<Trosak[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Kooperant | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Kooperant | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [k, t] = await Promise.all([fetchKooperanti(), fetchTroskovi()]);
      setItems(k);
      setTroskovi(t);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const byKooperant = useMemo(() => {
    const map = new Map<string, Trosak[]>();
    troskovi.forEach((t) => {
      if (!t.kooperant_id) return;
      map.set(t.kooperant_id, [...(map.get(t.kooperant_id) ?? []), t]);
    });
    return map;
  }, [troskovi]);

  const filtered = items.filter((k) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [k.naziv, k.djelatnost, k.oib, k.kontakt_osoba, k.mjesto, k.telefon, k.email].some((v) => (v ?? '').toLowerCase().includes(q));
  });

  const openForm = (k?: Kooperant) => {
    setEditing(k ?? null);
    setForm(k ? {
      naziv: k.naziv,
      djelatnost: k.djelatnost ?? '',
      oib: k.oib ?? '',
      iban: k.iban ?? '',
      adresa: k.adresa ?? '',
      mjesto: k.mjesto ?? '',
      postanski_broj: k.postanski_broj ?? '',
      kontakt_osoba: k.kontakt_osoba ?? '',
      telefon: k.telefon ?? '',
      email: k.email ?? '',
      web: k.web ?? '',
      napomena: k.napomena ?? '',
    } : emptyForm);
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.naziv.trim()) return;
    setSaving(true);
    setError(null);
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || null])) as typeof form;
    try {
      if (editing) await updateKooperant(editing.id, { ...payload, naziv: form.naziv.trim() });
      else await createKooperant({ ...payload, naziv: form.naziv.trim() });
      setModalOpen(false);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await deleteKooperant(deleteTarget.id);
      setDeleteTarget(null);
      await load();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const set = (key: keyof typeof emptyForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((previous) => ({ ...previous, [key]: event.target.value }));

  if (loading) return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;

  const grandTotal = troskovi.filter((t) => t.kooperant_id).reduce((sum, t) => sum + t.iznos, 0);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Kooperanti</h1>
          <p className="mt-1 text-sm text-slate-500">Baza kooperanata i njihovi troškovi po gradilištima · ukupno {eur(grandTotal)}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            disabled={filtered.length === 0}
            build={() => ({
              file: 'Kooperanti',
              title: 'Kooperanti',
              rows: filtered,
              columns: [
                { header: 'Naziv', get: (k: Kooperant) => k.naziv },
                { header: 'Djelatnost', get: (k: Kooperant) => k.djelatnost ?? '' },
                { header: 'OIB', get: (k: Kooperant) => k.oib ?? '' },
                { header: 'IBAN', get: (k: Kooperant) => k.iban ?? '' },
                { header: 'Adresa', get: (k: Kooperant) => [k.adresa, k.postanski_broj, k.mjesto].filter(Boolean).join(', ') },
                { header: 'Kontakt', get: (k: Kooperant) => k.kontakt_osoba ?? '' },
                { header: 'Telefon', get: (k: Kooperant) => k.telefon ?? '' },
                { header: 'Email', get: (k: Kooperant) => k.email ?? '' },
                { header: 'Troškovi', kind: 'eur', get: (k: Kooperant) => (byKooperant.get(k.id) ?? []).reduce((s, t) => s + t.iznos, 0) },
              ],
            })}
          />
          <button type="button" onClick={() => openForm()} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-sky-700">
            <Plus className="h-4 w-4" /> Novi kooperant
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pretraži kooperante…" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Handshake className="h-7 w-7" />}
          title="Nema kooperanata"
          description="Dodajte kooperanta pa ga birajte pri unosu troška na gradilištu."
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((k) => {
            const list = byKooperant.get(k.id) ?? [];
            const total = list.reduce((sum, t) => sum + t.iznos, 0);
            const perSite = new Map<string, { naziv: string; total: number; rows: Trosak[] }>();
            list.forEach((t) => {
              const key = t.gradiliste_id ?? 'none';
              const entry = perSite.get(key) ?? { naziv: t.gradilista?.naziv ?? 'Bez gradilišta', total: 0, rows: [] };
              entry.total += t.iznos;
              entry.rows.push(t);
              perSite.set(key, entry);
            });
            const open = expanded === k.id;
            return (
              <div key={k.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-3 p-4">
                  <button type="button" onClick={() => setExpanded(open ? null : k.id)} className="text-slate-400 hover:text-slate-700">
                    {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{k.naziv}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[k.djelatnost, k.oib && `OIB ${k.oib}`, k.kontakt_osoba, k.telefon, k.email].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{eur(total)}</p>
                    <p className="text-xs text-slate-500">{perSite.size} gradilišta · {list.length} stavki</p>
                  </div>
                  <button type="button" onClick={() => openForm(k)} className="rounded p-2 text-slate-500 hover:bg-slate-100" title="Uredi"><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setDeleteTarget(k)} className="rounded p-2 text-red-500 hover:bg-red-50" title="Izbriši"><Trash2 className="h-4 w-4" /></button>
                </div>
                {open && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4">
                    {perSite.size === 0 ? (
                      <p className="text-sm text-slate-500">Još nema troškova za ovog kooperanta.</p>
                    ) : (
                      <div className="space-y-3">
                        {[...perSite.values()].map((site) => (
                          <div key={site.naziv}>
                            <div className="flex justify-between text-sm font-semibold text-slate-800">
                              <span>{site.naziv}</span>
                              <span>{eur(site.total)}</span>
                            </div>
                            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                              {site.rows.map((t) => (
                                <li key={t.id} className="flex justify-between">
                                  <span>{new Date(`${t.datum}T00:00:00`).toLocaleDateString('hr-HR')} · {t.opis}</span>
                                  <span>{eur(t.iznos)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi kooperanta' : 'Novi kooperant'}
        footer={(
          <>
            <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Odustani</button>
            <button type="button" onClick={() => void save()} disabled={saving || !form.naziv.trim()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50">
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        )}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Field label="Naziv *"><TextInput value={form.naziv} onChange={set('naziv')} /></Field></div>
          <Field label="Djelatnost"><TextInput value={form.djelatnost} onChange={set('djelatnost')} placeholder="npr. elektro, vodoinstalacije" /></Field>
          <Field label="OIB"><TextInput value={form.oib} onChange={set('oib')} /></Field>
          <div className="col-span-2"><Field label="IBAN"><TextInput value={form.iban} onChange={set('iban')} /></Field></div>
          <div className="col-span-2"><Field label="Adresa"><TextInput value={form.adresa} onChange={set('adresa')} /></Field></div>
          <Field label="Mjesto"><TextInput value={form.mjesto} onChange={set('mjesto')} /></Field>
          <Field label="Poštanski broj"><TextInput value={form.postanski_broj} onChange={set('postanski_broj')} /></Field>
          <Field label="Kontakt osoba"><TextInput value={form.kontakt_osoba} onChange={set('kontakt_osoba')} /></Field>
          <Field label="Telefon"><TextInput value={form.telefon} onChange={set('telefon')} /></Field>
          <Field label="Email"><TextInput value={form.email} onChange={set('email')} /></Field>
          <Field label="Web"><TextInput value={form.web} onChange={set('web')} /></Field>
          <div className="col-span-2"><Field label="Napomena"><Textarea value={form.napomena} onChange={set('napomena')} rows={3} /></Field></div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        title="Izbrisati kooperanta?"
        message="Postojeći troškovi ostaju na gradilištu, ali neće više biti povezani s ovim kooperantom."
      />
    </div>
  );
}
