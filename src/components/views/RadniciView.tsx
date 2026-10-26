import { useState, useEffect, useMemo } from 'react';
import { Users, Plus, Pencil, Trash2, Phone, Mail, HardHat, ArrowDown, ArrowUp, ArrowUpDown, Eye, EyeOff, History } from 'lucide-react';
import type { Radnik, RadnikStatus, BonusTip, RadnikPovijest } from '@/types';
import { RadnikDokumenti } from '@/components/views/RadnikDokumenti';
import { fetchRadnici, createRadnik, updateRadnik, deleteRadnik, fetchRadnikPovijest, addRadnikPovijest } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ExportMenu } from '@/components/ui/ExportMenu';

const statusBadge: Record<RadnikStatus, { variant: 'green' | 'gray' | 'orange'; label: string }> = {
  aktivan: { variant: 'green', label: 'Aktivan' },
  neaktivan: { variant: 'gray', label: 'Neaktivan' },
  bolovanje: { variant: 'orange', label: 'Bolovanje' },
};

const bonusTipovi: Record<BonusTip, string> = {
  pausalno: 'Paušalno',
  komad: 'Po komadu',
  dan: 'Po danu',
  sat: 'Po satu',
};

function emptyBonus() {
  return { naziv: '', iznos: '', tip: 'pausalno' as BonusTip };
}

const emptyForm = {
  ime: '',
  prezime: '',
  uloga: 'radnik',
  telefon: '',
  email: '',
  status: 'aktivan' as RadnikStatus,
  cijena_sata: '',
  nocni_dodatak: '30',
  teren_dnevnica: '',
  cijena_praznik: '',
  cijena_godisnji: '',
  cijena_bolovanje: '',
  cijena_put_sat: '',
  bonusi: [emptyBonus(), emptyBonus(), emptyBonus()],
};

type SortKey = 'ime' | 'satnica' | 'nocna' | 'teren' | 'praznik' | 'godisnji' | 'bolovanje' | 'put';

const eur = (v: number | null | undefined) => (v ? `${v.toLocaleString('hr-HR', { minimumFractionDigits: 2 })} €` : '—');

const polja: Record<string, string> = {
  cijena_sata: 'Satnica (€/h)',
  nocni_dodatak: 'Noćni dodatak (%)',
  teren_dnevnica: 'Teren dnevnica (€)',
  cijena_praznik: 'Praznik (€/dan)',
  cijena_godisnji: 'Godišnji (€/dan)',
  cijena_bolovanje: 'Bolovanje (€/dan)',
  cijena_put_sat: 'Plaćeni put (€/h)',
  bonusi: 'Bonusi',
};

const bonusText = (b: Radnik['bonusi'] | undefined) =>
  (b ?? []).filter((x) => x.naziv || x.iznos).map((x) => `${x.naziv || '?'}: ${x.iznos} € (${x.tip})`).join('; ');

export function RadniciView() {
  const [items, setItems] = useState<Radnik[]>([]);
  const [prikaz, setPrikaz] = useState(() => localStorage.getItem('tm_prikaz_cijene_radnika') !== '0');
  const [povijest, setPovijest] = useState<RadnikPovijest[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('ime');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Radnik | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const togglePrikaz = () => {
    const next = !prikaz;
    setPrikaz(next);
    localStorage.setItem('tm_prikaz_cijene_radnika', next ? '1' : '0');
  };

  const loadPovijest = (id: string) => {
    fetchRadnikPovijest(id).then(setPovijest).catch(() => setPovijest([]));
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchRadnici());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri učitavanju');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (r: Radnik) => {
    setEditing(r);
    loadPovijest(r.id);
    setForm({
      ime: r.ime,
      prezime: r.prezime,
      uloga: r.uloga,
      telefon: r.telefon ?? '',
      email: r.email ?? '',
      status: r.status,
      cijena_sata: r.cijena_sata?.toString() ?? '',
      nocni_dodatak: (r.nocni_dodatak ?? 30).toString(),
      teren_dnevnica: r.teren_dnevnica ? r.teren_dnevnica.toString() : '',
      cijena_praznik: r.cijena_praznik ? r.cijena_praznik.toString() : '',
      cijena_godisnji: r.cijena_godisnji ? r.cijena_godisnji.toString() : '',
      cijena_bolovanje: r.cijena_bolovanje ? r.cijena_bolovanje.toString() : '',
      cijena_put_sat: r.cijena_put_sat ? r.cijena_put_sat.toString() : '',
      bonusi: [0, 1, 2].map((i) => {
        const b = r.bonusi?.[i];
        return b ? { naziv: b.naziv, iznos: b.iznos ? b.iznos.toString() : '', tip: b.tip } : emptyBonus();
      }),
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.ime.trim() || !form.prezime.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ime: form.ime.trim(),
        prezime: form.prezime.trim(),
        uloga: form.uloga.trim() || 'radnik',
        telefon: form.telefon.trim() || null,
        email: form.email.trim() || null,
        status: form.status,
        cijena_sata: form.cijena_sata ? parseFloat(form.cijena_sata) : 0,
        nocni_dodatak: form.nocni_dodatak ? parseFloat(form.nocni_dodatak) : 0,
        teren_dnevnica: form.teren_dnevnica ? parseFloat(form.teren_dnevnica) : 0,
        cijena_praznik: form.cijena_praznik ? parseFloat(form.cijena_praznik) : 0,
        cijena_godisnji: form.cijena_godisnji ? parseFloat(form.cijena_godisnji) : 0,
        cijena_bolovanje: form.cijena_bolovanje ? parseFloat(form.cijena_bolovanje) : 0,
        cijena_put_sat: form.cijena_put_sat ? parseFloat(form.cijena_put_sat) : 0,
        bonusi: form.bonusi.map((b) => ({ naziv: b.naziv.trim(), iznos: b.iznos ? parseFloat(b.iznos) : 0, tip: b.tip })),
      };
      if (editing) {
        await updateRadnik(editing.id, payload);
        const before = editing as unknown as Record<string, number | null>;
        const after = payload as unknown as Record<string, number>;
        const rows = Object.keys(polja)
          .filter((k) => k !== 'bonusi' && Number(before[k] ?? 0) !== Number(after[k] ?? 0))
          .map((k) => ({ radnik_id: editing.id, polje: polja[k], stara_vrijednost: String(before[k] ?? 0), nova_vrijednost: String(after[k]) }));
        const oldB = bonusText(editing.bonusi);
        const newB = bonusText(payload.bonusi);
        if (oldB !== newB) rows.push({ radnik_id: editing.id, polje: polja.bonusi, stara_vrijednost: oldB || '—', nova_vrijednost: newB || '—' });
        // Povijest je opcionalna: tablica postoji tek nakon migracije
        await addRadnikPovijest(rows).catch(() => undefined);
        setModalOpen(false);
      } else {
        // Nakon kreiranja ostaje otvoreno da se odmah mogu dodati dokumenti
        const created = await createRadnik(payload);
        setEditing(created);
      }
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
      await deleteRadnik(deleteId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju');
    }
  };

  const sorted = useMemo(() => {
    const val = (r: Radnik) => {
      switch (sortKey) {
        case 'ime': return `${r.prezime} ${r.ime}`.toLowerCase();
        case 'satnica': return r.cijena_sata ?? 0;
        case 'nocna': return r.nocni_dodatak ?? 0;
        case 'teren': return r.teren_dnevnica ?? 0;
        case 'praznik': return r.cijena_praznik ?? 0;
        case 'godisnji': return r.cijena_godisnji ?? 0;
        case 'bolovanje': return r.cijena_bolovanje ?? 0;
        case 'put': return r.cijena_put_sat ?? 0;
      }
    };
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [items, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(k);
      setSortDir(k === 'ime' ? 'asc' : 'desc');
    }
  };

  const sortTh = (k: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th className={`px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 text-${align}`}>
      <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-sky-600 ${sortKey === k ? 'text-sky-600' : ''}`}>
        {label}
        {sortKey === k ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div className="min-w-0 max-w-full">
      <div className="mb-6 flex min-w-0 flex-col items-stretch justify-between gap-3 xl:flex-row xl:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Radnici</h1>
          <p className="text-sm text-slate-500 mt-1">Upravljajte radnicima i njihovim ulogama</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
          <ExportMenu
            disabled={sorted.length === 0}
            build={() => ({
              file: 'Radnici',
              title: 'Radnici',
              rows: sorted,
              columns: [
                { header: 'Prezime', get: (r: Radnik) => r.prezime },
                { header: 'Ime', get: (r: Radnik) => r.ime },
                { header: 'Uloga', get: (r: Radnik) => r.uloga },
                { header: 'Status', get: (r: Radnik) => statusBadge[r.status].label },
                { header: 'Telefon', get: (r: Radnik) => r.telefon ?? '' },
                { header: 'Email', get: (r: Radnik) => r.email ?? '' },
                { header: 'Cijena sata', kind: 'eur', get: (r: Radnik) => r.cijena_sata },
                { header: 'Noćni dodatak', kind: 'eur', get: (r: Radnik) => r.nocni_dodatak ?? 0 },
                { header: 'Teren dnevnica', kind: 'eur', get: (r: Radnik) => r.teren_dnevnica ?? 0 },
              ],
            })}
          />
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Novi radnik
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7" />}
          title="Nema radnika"
          description="Dodajte radnike da biste ih mogli rasporediti po gradilištima."
          action={
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Novi radnik
            </button>
          }
        />
      ) : (
        <>
        <div className="mb-3 flex min-w-0 flex-col gap-2 text-sm xl:flex-row xl:flex-wrap xl:items-center">
          <button type="button" onClick={togglePrikaz} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">
            {prikaz ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {prikaz ? 'Sakrij cijene' : 'Prikaži cijene'}
          </button>
          <span className="text-xs text-slate-400">Ugovorene cijene: satnica €/h, noćna %, teren/praznik/godišnji/bolovanje €/dan, put €/h</span>
        </div>
        <div className="min-w-0 max-w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {sortTh('ime', 'Radnik', 'left')}
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Uloga</th>
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Kontakt</th>
                {prikaz && (
                  <>
                    {sortTh('satnica', 'Satnica')}
                    {sortTh('nocna', 'Noćna')}
                    {sortTh('teren', 'Teren')}
                    {sortTh('praznik', 'Praznik')}
                    {sortTh('godisnji', 'Godišnji')}
                    {sortTh('bolovanje', 'Bolovanje')}
                    {sortTh('put', 'Put')}
                  </>
                )}
                <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Akcije</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const sb = statusBadge[r.status];
                return (
                  <tr key={r.id} className="group hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                          <HardHat className="h-4.5 w-4.5" />
                        </div>
                        <span className="font-medium text-slate-900">
                          {r.ime} {r.prezime}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">{r.uloga}</td>
                    <td className="px-5 py-3.5">
                      <div className="space-y-0.5 text-xs text-slate-500">
                        {r.telefon && (
                          <span className="flex items-center gap-1.5">
                            <Phone className="h-3.5 w-3.5" />
                            {r.telefon}
                          </span>
                        )}
                        {r.email && (
                          <span className="flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5" />
                            {r.email}
                          </span>
                        )}
                      </div>
                    </td>
                    {prikaz && (
                      <>
                        <td className="px-3 py-3.5 text-right text-sm font-semibold text-slate-800">{r.cijena_sata > 0 ? `${eur(r.cijena_sata)}/h` : '—'}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-indigo-700">{r.nocni_dodatak ? `${r.nocni_dodatak} %` : '—'}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-amber-700">{eur(r.teren_dnevnica)}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-slate-600">{eur(r.cijena_praznik)}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-emerald-700">{eur(r.cijena_godisnji)}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-red-600">{eur(r.cijena_bolovanje)}</td>
                        <td className="px-3 py-3.5 text-right text-sm text-slate-600">{eur(r.cijena_put_sat)}</td>
                      </>
                    )}
                    <td className="px-5 py-3.5">
                      <Badge variant={sb.variant}>{sb.label}</Badge>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEdit(r)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteId(r.id)}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi radnika' : 'Novi radnik'}
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
              disabled={saving || !form.ime.trim() || !form.prezime.trim()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <Field label="Ime *">
              <TextInput
                value={form.ime}
                onChange={(e) => setForm({ ...form, ime: e.target.value })}
                placeholder="npr. Marko"
              />
            </Field>
            <Field label="Prezime *">
              <TextInput
                value={form.prezime}
                onChange={(e) => setForm({ ...form, prezime: e.target.value })}
                placeholder="npr. Horvat"
              />
            </Field>
          </div>
          <Field label="Uloga">
            <TextInput
              value={form.uloga}
              onChange={(e) => setForm({ ...form, uloga: e.target.value })}
              placeholder="npr. zidar, vozač, voditelj…"
            />
          </Field>
          <Field label="Telefon">
            <TextInput
              value={form.telefon}
              onChange={(e) => setForm({ ...form, telefon: e.target.value })}
              placeholder="+385 91 234 5678"
            />
          </Field>
          <Field label="Email">
            <TextInput
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="marko@firma.hr"
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as RadnikStatus })}
            >
              <option value="aktivan">Aktivan</option>
              <option value="neaktivan">Neaktivan</option>
              <option value="bolovanje">Bolovanje</option>
            </Select>
          </Field>
          <Field label="Cijena radnog sata (EUR/h)">
            <TextInput
              type="number"
              step="0.50"
              value={form.cijena_sata}
              onChange={(e) => setForm({ ...form, cijena_sata: e.target.value })}
              placeholder="0.00"
            />
          </Field>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <Field label="Noćni dodatak (%) – rad 22:00–06:00">
              <TextInput
                type="number"
                step="1"
                min="0"
                value={form.nocni_dodatak}
                onChange={(e) => setForm({ ...form, nocni_dodatak: e.target.value })}
              />
            </Field>
            <Field label="Teren – dnevnica (EUR/dan)">
              <TextInput
                type="number"
                step="0.50"
                min="0"
                value={form.teren_dnevnica}
                onChange={(e) => setForm({ ...form, teren_dnevnica: e.target.value })}
                placeholder="0.00"
              />
            </Field>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">Ostale cijene</p>
            <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
              <Field label="Praznik (EUR/dan)">
                <TextInput type="number" step="0.50" min="0" value={form.cijena_praznik} onChange={(e) => setForm({ ...form, cijena_praznik: e.target.value })} placeholder="0.00" />
              </Field>
              <Field label="Godišnji (EUR/dan)">
                <TextInput type="number" step="0.50" min="0" value={form.cijena_godisnji} onChange={(e) => setForm({ ...form, cijena_godisnji: e.target.value })} placeholder="0.00" />
              </Field>
              <Field label="Bolovanje (EUR/dan)">
                <TextInput type="number" step="0.50" min="0" value={form.cijena_bolovanje} onChange={(e) => setForm({ ...form, cijena_bolovanje: e.target.value })} placeholder="0.00" />
              </Field>
              <Field label="Plaćeni put (EUR/h)">
                <TextInput type="number" step="0.50" min="0" value={form.cijena_put_sat} onChange={(e) => setForm({ ...form, cijena_put_sat: e.target.value })} placeholder="0.00" />
              </Field>
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">Bonusi</p>
            <div className="space-y-2">
              {form.bonusi.map((b, i) => (
                <div key={i} className="grid min-w-0 grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_5.5rem_7rem]">
                  <TextInput value={b.naziv} onChange={(e) => setForm({ ...form, bonusi: form.bonusi.map((x, j) => (j === i ? { ...x, naziv: e.target.value } : x)) })} placeholder={`Bonus ${i + 1}`} />
                  <TextInput type="number" step="0.50" min="0" value={b.iznos} onChange={(e) => setForm({ ...form, bonusi: form.bonusi.map((x, j) => (j === i ? { ...x, iznos: e.target.value } : x)) })} placeholder="€" />
                  <Select value={b.tip} onChange={(e) => setForm({ ...form, bonusi: form.bonusi.map((x, j) => (j === i ? { ...x, tip: e.target.value as BonusTip } : x)) })}>
                    {Object.entries(bonusTipovi).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          </div>
          {editing ? (
            <>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-800"><History className="h-4 w-4" /> Povijest promjena plaće</p>
                {povijest.length === 0 ? (
                  <p className="text-xs text-slate-400">Još nema zabilježenih promjena (bilježe se od sada pri svakom spremanju).</p>
                ) : (
                  <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto text-xs">
                    {povijest.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-2 py-1.5">
                        <span className="w-20 text-slate-400">{new Date(p.created_at).toLocaleDateString('hr-HR')}</span>
                        <span className="font-medium text-slate-700">{p.polje}</span>
                        <span className="text-slate-500">{p.stara_vrijednost} → <b className="text-slate-800">{p.nova_vrijednost}</b></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <RadnikDokumenti radnikId={editing.id} />
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">Dokumenti i rokovi mogu se dodati nakon prvog spremanja radnika.</p>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Izbrisati radnika?"
        message="Ova radnja je nepovratna. Radnik će biti uklonjen iz svih rasporeda."
      />
    </div>
  );
}
