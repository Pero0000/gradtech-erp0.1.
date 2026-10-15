import { useState, useEffect } from 'react';
import { Truck, Plus, Pencil, Trash2, Gauge, Calendar, Users } from 'lucide-react';
import type { Vozilo, VoziloStatus, VoziloTip } from '@/types';
import { fetchVozila, createVozilo, updateVozilo, deleteVozilo } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';

const statusBadge: Record<VoziloStatus, { variant: 'green' | 'red' | 'yellow'; label: string }> = {
  slobodno: { variant: 'green', label: 'Slobodno' },
  zauzeto: { variant: 'red', label: 'Zauzeto' },
  servis: { variant: 'yellow', label: 'Servis' },
};

const tipLabel: Record<VoziloTip, string> = {
  teretno: 'Teretno',
  dostavno: 'Dostavno',
  radno: 'Radno',
  putnicko: 'Putničko',
};

const emptyForm = {
  registracija: '',
  marka: '',
  model: '',
  tip: 'teretno' as VoziloTip,
  status: 'slobodno' as VoziloStatus,
  kilometraza: '',
  godina_proizvodnje: '',
  broj_mjesta: '2',
  napomena: '',
};

export function VozilaView() {
  const [items, setItems] = useState<Vozilo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vozilo | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchVozila());
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

  const openEdit = (v: Vozilo) => {
    setEditing(v);
    setForm({
      registracija: v.registracija,
      marka: v.marka,
      model: v.model ?? '',
      tip: v.tip,
      status: v.status,
      kilometraza: v.kilometraza?.toString() ?? '',
      godina_proizvodnje: v.godina_proizvodnje?.toString() ?? '',
      broj_mjesta: v.broj_mjesta?.toString() ?? '2',
      napomena: v.napomena ?? '',
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.registracija.trim() || !form.marka.trim()) return;
    setSaving(true);
    try {
      const payload = {
        registracija: form.registracija.trim(),
        marka: form.marka.trim(),
        model: form.model.trim() || null,
        tip: form.tip,
        status: form.status,
        kilometraza: form.kilometraza ? parseInt(form.kilometraza) : 0,
        godina_proizvodnje: form.godina_proizvodnje ? parseInt(form.godina_proizvodnje) : null,
        broj_mjesta: form.broj_mjesta ? parseInt(form.broj_mjesta) : 2,
        napomena: form.napomena.trim() || null,
      };
      if (editing) {
        await updateVozilo(editing.id, payload);
      } else {
        await createVozilo(payload);
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
      await deleteVozilo(deleteId);
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
          <h1 className="text-2xl font-bold text-slate-900">Vozila</h1>
          <p className="text-sm text-slate-500 mt-1">Upravljajte vozilnim parkom firme</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Novo vozilo
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-7 w-7" />}
          title="Nema vozila"
          description="Dodajte vozila da biste ih mogli rasporediti po gradilištima."
          action={
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Novo vozilo
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((v) => {
            const sb = statusBadge[v.status];
            return (
              <div
                key={v.id}
                className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                      <Truck className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 leading-tight">{v.marka} {v.model}</h3>
                      <p className="text-xs font-medium text-slate-500">{v.registracija}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(v)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteId(v.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="blue">{tipLabel[v.tip]}</Badge>
                  <Badge variant={sb.variant}>{sb.label}</Badge>
                </div>

                <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                  {v.kilometraza > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Gauge className="h-3.5 w-3.5" />
                      {v.kilometraza.toLocaleString('hr-HR')} km
                    </span>
                  )}
                  {v.godina_proizvodnje && (
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      {v.godina_proizvodnje}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {v.broj_mjesta} mjesta
                  </span>
                </div>

                {v.napomena && <p className="mt-3 text-sm text-slate-600 line-clamp-2">{v.napomena}</p>}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Uredi vozilo' : 'Novo vozilo'}
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
              disabled={saving || !form.registracija.trim() || !form.marka.trim()}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Spremanje…' : 'Spremi'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Registracija *">
              <TextInput
                value={form.registracija}
                onChange={(e) => setForm({ ...form, registracija: e.target.value })}
                placeholder="ZG-123-AB"
              />
            </Field>
            <Field label="Marka *">
              <TextInput
                value={form.marka}
                onChange={(e) => setForm({ ...form, marka: e.target.value })}
                placeholder="npr. Mercedes"
              />
            </Field>
          </div>
          <Field label="Model">
            <TextInput
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="npr. Actros"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tip">
              <Select
                value={form.tip}
                onChange={(e) => setForm({ ...form, tip: e.target.value as VoziloTip })}
              >
                <option value="teretno">Teretno</option>
                <option value="dostavno">Dostavno</option>
                <option value="radno">Radno</option>
                <option value="putnicko">Putničko</option>
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as VoziloStatus })}
              >
                <option value="slobodno">Slobodno</option>
                <option value="zauzeto">Zauzeto</option>
                <option value="servis">Servis</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Kilometraža">
              <TextInput
                type="number"
                value={form.kilometraza}
                onChange={(e) => setForm({ ...form, kilometraza: e.target.value })}
                placeholder="0"
              />
            </Field>
            <Field label="Godina proizvodnje">
              <TextInput
                type="number"
                value={form.godina_proizvodnje}
                onChange={(e) => setForm({ ...form, godina_proizvodnje: e.target.value })}
                placeholder="2020"
              />
            </Field>
          </div>
          <Field label="Broj mjesta (uključujući vozača)">
            <TextInput
              type="number"
              min="1"
              value={form.broj_mjesta}
              onChange={(e) => setForm({ ...form, broj_mjesta: e.target.value })}
              placeholder="2"
            />
          </Field>
          <Field label="Napomena">
            <Textarea
              rows={2}
              value={form.napomena}
              onChange={(e) => setForm({ ...form, napomena: e.target.value })}
              placeholder="Servis, kvar, posebnosti…"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Izbrisati vozilo?"
        message="Ova radnja je nepovratna. Vozilo će biti uklonjeno iz svih rasporeda."
      />
    </div>
  );
}
