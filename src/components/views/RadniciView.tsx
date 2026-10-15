import { useState, useEffect } from 'react';
import { Users, Plus, Pencil, Trash2, Phone, Mail, HardHat, Euro } from 'lucide-react';
import type { Radnik, RadnikStatus, BonusTip } from '@/types';
import { RadnikDokumenti } from '@/components/views/RadnikDokumenti';
import { fetchRadnici, createRadnik, updateRadnik, deleteRadnik } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';

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

export function RadniciView() {
  const [items, setItems] = useState<Radnik[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Radnik | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Radnici</h1>
          <p className="text-sm text-slate-500 mt-1">Upravljajte radnicima i njihovim ulogama</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Novi radnik
        </button>
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
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Radnik</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Uloga</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Kontakt</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Satnica</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Akcije</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((r) => {
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
                    <td className="px-5 py-3.5 text-right">
                      {r.cijena_sata > 0 ? (
                        <span className="inline-flex items-center gap-1 text-sm font-medium text-slate-700">
                          <Euro className="h-3.5 w-3.5 text-slate-400" />
                          {r.cijena_sata.toLocaleString('hr-HR', { minimumFractionDigits: 2 })} €/h
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
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
          <div className="grid grid-cols-2 gap-4">
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
          <div className="grid grid-cols-2 gap-4">
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
            <div className="grid grid-cols-2 gap-3">
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
                <div key={i} className="grid grid-cols-[1fr_5.5rem_7rem] gap-2">
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
            <RadnikDokumenti radnikId={editing.id} />
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
