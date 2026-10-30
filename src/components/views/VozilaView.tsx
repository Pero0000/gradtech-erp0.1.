import { useState, useEffect, useMemo } from 'react';
import { Truck, Plus, Pencil, Trash2, Gauge, Calendar, Users, Weight, LayoutGrid, Table2, ArrowDown, ArrowUp, ArrowUpDown, RefreshCw } from 'lucide-react';
import type { DnevniRasporedGradiliste, Vozilo, VoziloStatus, VoziloTip, VoziloDokument } from '@/types';
import { servisAlert, nextServis } from '@/lib/servis';
import { jamstvoInfo } from '@/lib/jamstvo';
import { AlertTriangle } from 'lucide-react';
import { VoziloDokumenti } from '@/components/views/VoziloDokumenti';
import { fetchVozila, createVozilo, updateVozilo, deleteVozilo, fetchSviServisi, fetchDnevniRaspored, recalculateVehicleKmCosts } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Field, TextInput, Select, Textarea } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ExportMenu } from '@/components/ui/ExportMenu';
import { VoziloFleetDetalji } from '@/components/views/VoziloFleetDetalji';
import { todayISO } from '@/lib/rokovi';

type VehicleDisplayStatus = VoziloStatus | 'na_gradilistu';

const statusBadge: Record<VehicleDisplayStatus, { variant: 'green' | 'red' | 'yellow'; label: string }> = {
  slobodno: { variant: 'green', label: 'Slobodno' },
  zauzeto: { variant: 'red', label: 'Zauzeto' },
  na_gradilistu: { variant: 'red', label: 'Na gradilištu' },
  servis: { variant: 'yellow', label: 'Servis' },
  neispravno: { variant: 'red', label: 'Neispravno' },
};

function displayStatus(vehicle: Vozilo, todaysAssignments: DnevniRasporedGradiliste[]): VehicleDisplayStatus {
  if (vehicle.status === 'servis' || vehicle.status === 'neispravno') return vehicle.status;
  return todaysAssignments.some((assignment) =>
    assignment.vozilo_id === vehicle.id && Boolean(assignment.gradiliste_id),
  ) ? 'na_gradilistu' : vehicle.status;
}

function storedStatus(status: VehicleDisplayStatus): VoziloStatus {
  return status === 'na_gradilistu' ? 'zauzeto' : status;
}

const tipLabel: Record<VoziloTip, string> = {
  teretno: 'Teretno',
  dostavno: 'Dostavno',
  radno: 'Radno',
  putnicko: 'Putničko',
};

type SortKey = 'vozilo' | 'tip' | 'status' | 'kilometraza' | 'godina' | 'mjesta' | 'nosivost' | 'masa' | 'enc' | 'servis' | 'napomena';

const emptyForm = {
  registracija: '',
  marka: '',
  model: '',
  tip: 'teretno' as VoziloTip,
  status: 'slobodno' as VoziloStatus,
  kilometraza: '',
  godina_proizvodnje: '',
  broj_mjesta: '2',
  cijena_km: '',
  nosivost_kg: '',
  masa_kg: '',
  u_rasporedu: true,
  enc_broj: '',
  servis_interval_km: '',
  servis_interval_mjeseci: '',
  servis_upozorenje_km: '1000',
  servis_upozorenje_dana: '30',
  sljedeci_servis_napomena: '',
  jamstvo_aktivno: false,
  jamstvo_od: '',
  jamstvo_mjeseci: '',
  jamstvo_do_km: '',
  jamstvo_uvjeti: '',
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
  const [recalculatingKm, setRecalculatingKm] = useState(false);
  const [kmRecalculationMessage, setKmRecalculationMessage] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vozilo | null>(null);
  const [todaysAssignments, setTodaysAssignments] = useState<DnevniRasporedGradiliste[]>([]);
  const [prikaz, setPrikaz] = useState<'kartice' | 'tablica'>(() => (localStorage.getItem('tm_vozila_prikaz') === 'tablica' ? 'tablica' : 'kartice'));
  const [sortKey, setSortKey] = useState<SortKey>('vozilo');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const setView = (p: 'kartice' | 'tablica') => {
    setPrikaz(p);
    localStorage.setItem('tm_vozila_prikaz', p);
  };
  const [servisi, setServisi] = useState<VoziloDokument[]>([]);
  const loadServisi = () => fetchSviServisi().then(setServisi).catch(() => setServisi([]));

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [vehicles, services, schedule] = await Promise.all([
        fetchVozila(),
        fetchSviServisi(),
        fetchDnevniRaspored(todayISO()),
      ]);
      setItems(vehicles);
      setServisi(services);
      setTodaysAssignments(schedule.gradilista);
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
    setKmRecalculationMessage(null);
    setModalOpen(true);
  };

  const openEdit = (v: Vozilo) => {
    setEditing(v);
    setKmRecalculationMessage(null);
    setForm({
      registracija: v.registracija,
      marka: v.marka,
      model: v.model ?? '',
      tip: v.tip,
      status: v.status,
      kilometraza: v.kilometraza?.toString() ?? '',
      godina_proizvodnje: v.godina_proizvodnje?.toString() ?? '',
      broj_mjesta: v.broj_mjesta?.toString() ?? '2',
      cijena_km: v.cijena_km ? v.cijena_km.toString() : '',
      nosivost_kg: v.nosivost_kg ? v.nosivost_kg.toString() : '',
      masa_kg: v.masa_kg ? v.masa_kg.toString() : '',
      u_rasporedu: v.u_rasporedu !== false,
      enc_broj: v.enc_broj ?? '',
      servis_interval_km: v.servis_interval_km ? v.servis_interval_km.toString() : '',
      servis_interval_mjeseci: v.servis_interval_mjeseci ? v.servis_interval_mjeseci.toString() : '',
      servis_upozorenje_km: (v.servis_upozorenje_km ?? 1000).toString(),
      servis_upozorenje_dana: (v.servis_upozorenje_dana ?? 30).toString(),
      sljedeci_servis_napomena: v.sljedeci_servis_napomena ?? '',
      jamstvo_aktivno: v.jamstvo_aktivno ?? false,
      jamstvo_od: v.jamstvo_od ?? '',
      jamstvo_mjeseci: v.jamstvo_mjeseci?.toString() ?? '',
      jamstvo_do_km: v.jamstvo_do_km?.toString() ?? '',
      jamstvo_uvjeti: v.jamstvo_uvjeti ?? '',
      napomena: v.napomena ?? '',
    });
    setModalOpen(true);
  };

  const recalculateKm = async () => {
    if (!editing) return;
    setRecalculatingKm(true);
    setKmRecalculationMessage('Obračun je pokrenut. Provjeravam rasporede i završene naloge…');
    setError(null);
    try {
      const summary = await recalculateVehicleKmCosts(editing.id);
      const message = summary.createdCosts > 0
        ? `Obrađeno ${summary.createdCosts} troškova kroz ${summary.dates} dana (${summary.eligibleOrders} završenih naloga s upisanim kilometrima).`
        : summary.scheduledAssignments === 0
          ? 'Nema povijesnih rasporeda za ovo vozilo.'
          : summary.linkedOrders === 0
            ? `Vozilo je pronađeno u ${summary.scheduledAssignments} rasporeda kroz ${summary.dates} dana, ali rasporedi nemaju povezane radne naloge.`
          : summary.eligibleOrders === 0
            ? `Pronađeno je ${summary.linkedOrders} povezanih naloga, ali nijedan nema status Završeno i upisane početne i završne kilometre.`
            : `${summary.eligibleOrders} naloga ima upisane kilometre, ali iz njih nije nastao trošak. Provjerite cijenu/km i razliku kilometraže.`;
      setKmRecalculationMessage(message);
    } catch (reason) {
      setKmRecalculationMessage(reason instanceof Error ? reason.message : 'Ponovni obračun kilometara nije uspio.');
    } finally {
      setRecalculatingKm(false);
    }
  };

  const save = async () => {
    if (!form.registracija.trim() || !form.marka.trim()) return;
    if (form.jamstvo_mjeseci && (!Number.isInteger(Number(form.jamstvo_mjeseci)) || Number(form.jamstvo_mjeseci) < 1)) {
      setError('Trajanje jamstva mora biti pozitivan cijeli broj mjeseci.');
      return;
    }
    if (form.jamstvo_do_km && (!Number.isInteger(Number(form.jamstvo_do_km)) || Number(form.jamstvo_do_km) < 0)) {
      setError('Ograničenje kilometraže jamstva mora biti cijeli broj 0 ili veći.');
      return;
    }
    setSaving(true);
    setError(null);
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
        cijena_km: form.cijena_km ? parseFloat(form.cijena_km) : 0,
        nosivost_kg: form.nosivost_kg ? parseFloat(form.nosivost_kg) : null,
        masa_kg: form.masa_kg ? parseFloat(form.masa_kg) : null,
        u_rasporedu: form.u_rasporedu,
        enc_broj: form.enc_broj.trim() || null,
        servis_interval_km: form.servis_interval_km ? parseInt(form.servis_interval_km) : null,
        servis_interval_mjeseci: form.servis_interval_mjeseci ? parseInt(form.servis_interval_mjeseci) : null,
        servis_upozorenje_km: form.servis_upozorenje_km ? parseInt(form.servis_upozorenje_km) : 1000,
        servis_upozorenje_dana: form.servis_upozorenje_dana ? parseInt(form.servis_upozorenje_dana) : 30,
        sljedeci_servis_napomena: form.sljedeci_servis_napomena.trim() || null,
        jamstvo_aktivno: form.jamstvo_aktivno,
        jamstvo_od: form.jamstvo_od || null,
        jamstvo_mjeseci: form.jamstvo_mjeseci ? parseInt(form.jamstvo_mjeseci) : null,
        jamstvo_do_km: form.jamstvo_do_km ? parseInt(form.jamstvo_do_km) : null,
        jamstvo_uvjeti: form.jamstvo_uvjeti.trim() || null,
        napomena: form.napomena.trim() || null,
      };
      if (editing) {
        const { cijena_km, ...otherUpdates } = payload;
        const updatePayload = Number(cijena_km) === Number(editing.cijena_km ?? 0)
          ? otherUpdates
          : payload;
        await updateVozilo(editing.id, updatePayload);
        setModalOpen(false);
        setSelectedVehicle(null);
      } else {
        // Nakon kreiranja ostaje otvoreno da se odmah mogu dodati dokumenti i servisi
        const created = await createVozilo(payload);
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
      await deleteVozilo(deleteId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Greška pri brisanju');
    }
  };

  const openDetails = (vehicle: Vozilo) => setSelectedVehicle(vehicle);

  const sortedItems = useMemo(() => {
    const value = (vehicle: Vozilo): string | number => {
      switch (sortKey) {
        case 'vozilo': return `${vehicle.marka} ${vehicle.model ?? ''}`.trim();
        case 'tip': return tipLabel[vehicle.tip];
        case 'status': return statusBadge[displayStatus(vehicle, todaysAssignments)].label;
        case 'kilometraza': return vehicle.kilometraza ?? 0;
        case 'godina': return vehicle.godina_proizvodnje ?? 0;
        case 'mjesta': return vehicle.broj_mjesta ?? 0;
        case 'nosivost': return vehicle.nosivost_kg ?? 0;
        case 'masa': return vehicle.masa_kg ?? 0;
        case 'enc': return vehicle.enc_broj ?? '';
        case 'servis': {
          const service = nextServis(vehicle, servisi);
          if (service.datum) return `0:${service.datum}`;
          if (service.km !== null) return `1:${String(service.km).padStart(12, '0')}`;
          return '2:';
        }
        case 'napomena': return vehicle.napomena ?? '';
      }
    };
    const direction = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((first, second) => {
      const firstValue = value(first);
      const secondValue = value(second);
      const comparison = typeof firstValue === 'number' && typeof secondValue === 'number'
        ? firstValue - secondValue
        : String(firstValue).localeCompare(String(secondValue), 'hr', { numeric: true, sensitivity: 'base' });
      return comparison * direction;
    });
  }, [items, servisi, todaysAssignments, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((direction) => direction === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setSortDir(['vozilo', 'tip', 'status', 'enc', 'napomena'].includes(key) ? 'asc' : 'desc');
    }
  };

  const SortTh = ({ k, label, right = false }: { k: SortKey; label: string; right?: boolean }) => (
    <th aria-sort={sortKey === k ? sortDir === 'asc' ? 'ascending' : 'descending' : 'none'} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 ${right ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-sky-700 ${sortKey === k ? 'text-sky-700' : ''}`}>
        {label}
        {sortKey === k ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-slate-400">Učitavanje…</div>;
  }

  return (
    <div className="min-w-0 max-w-full break-words">
      <div className="mb-6 flex min-w-0 flex-col items-stretch justify-between gap-3 xl:flex-row xl:items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vozila</h1>
          <p className="text-sm text-slate-500 mt-1">Upravljajte vozilnim parkom firme</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
          <div className="inline-flex self-start rounded-lg border border-slate-200 bg-white p-0.5">
            <button type="button" onClick={() => setView('kartice')} className={`rounded-md p-2 ${prikaz === 'kartice' ? 'bg-sky-100 text-sky-700' : 'text-slate-500 hover:bg-slate-50'}`} title="Kartice"><LayoutGrid className="h-4 w-4" /></button>
            <button type="button" onClick={() => setView('tablica')} className={`rounded-md p-2 ${prikaz === 'tablica' ? 'bg-sky-100 text-sky-700' : 'text-slate-500 hover:bg-slate-50'}`} title="Tablica"><Table2 className="h-4 w-4" /></button>
          </div>
          <ExportMenu
            disabled={sortedItems.length === 0}
            build={() => ({
              file: 'Vozila',
              title: 'Vozila',
              rows: sortedItems,
              columns: [
                { header: 'Vozilo', get: (v: Vozilo) => [v.marka, v.model].filter(Boolean).join(' ') },
                { header: 'Tip', get: (v: Vozilo) => tipLabel[v.tip] },
                { header: 'Status', get: (v: Vozilo) => statusBadge[displayStatus(v, todaysAssignments)].label },
                { header: 'Kilometraža', kind: 'num', get: (v: Vozilo) => v.kilometraza },
                { header: 'Godina', get: (v: Vozilo) => v.godina_proizvodnje?.toString() ?? '' },
                { header: 'Mjesta', kind: 'num', get: (v: Vozilo) => v.broj_mjesta },
                { header: 'Cijena/km', kind: 'eur', get: (v: Vozilo) => v.cijena_km ?? 0 },
                { header: 'Napomena', get: (v: Vozilo) => v.napomena ?? '' },
              ],
            })}
          />
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Novo vozilo
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
      ) : prikaz === 'tablica' ? (
        <div className="min-w-0 max-w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <SortTh k="vozilo" label="Vozilo" />
                <SortTh k="tip" label="Tip" />
                <SortTh k="status" label="Status" />
                <th className="px-4 py-3 text-left">Jamstvo</th>
                <SortTh k="kilometraza" label="Km" right />
                <SortTh k="godina" label="Godina" right />
                <SortTh k="mjesta" label="Mjesta" right />
                <SortTh k="nosivost" label="Nosivost" right />
                <SortTh k="masa" label="Masa" right />
                <SortTh k="enc" label="ENC" />
                <SortTh k="servis" label="Idući servis" />
                <SortTh k="napomena" label="Napomena" />
                <th className="px-4 py-3 text-right">Akcije</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedItems.map((v, index) => {
                const sb = statusBadge[displayStatus(v, todaysAssignments)];
                const ns = nextServis(v, servisi);
                const alert = servisAlert(v, servisi);
                const warranty = jamstvoInfo({
                  aktivno: v.jamstvo_aktivno ?? false,
                  od: v.jamstvo_od,
                  mjeseci: v.jamstvo_mjeseci,
                  doVrijednosti: v.jamstvo_do_km,
                  trenutnaVrijednost: v.kilometraza,
                  jedinica: 'km',
                });
                const alertCls = alert?.level === 'overdue' ? 'text-red-600 font-semibold' : alert?.level === 'soon' ? 'text-red-500 font-medium' : 'text-slate-700';
                return (
                  <tr key={v.id} role="button" tabIndex={0} onClick={() => openDetails(v)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDetails(v); } }} className="group cursor-pointer hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900"><span className="mr-2 text-slate-400">{index + 1}.</span>{v.marka} {v.model} <span className="ml-1 text-xs text-slate-500">{v.registracija}</span></td>
                    <td className="px-4 py-3"><Badge variant="blue">{tipLabel[v.tip]}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={sb.variant}>{sb.label}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={warranty.tone}>{warranty.label}</Badge>{warranty.detail && <span className="mt-1 block text-xs text-slate-500">{warranty.detail}</span>}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{v.kilometraza.toLocaleString('hr-HR')}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{v.godina_proizvodnje ?? '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{v.broj_mjesta}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{v.nosivost_kg ? `${v.nosivost_kg.toLocaleString('hr-HR')} kg` : '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{v.masa_kg ? `${v.masa_kg.toLocaleString('hr-HR')} kg` : '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{v.enc_broj || '—'}</td>
                    <td className={`px-4 py-3 ${alertCls}`}>
                      {ns.km || ns.datum ? (
                        <>
                          {ns.km ? `${ns.km.toLocaleString('hr-HR')} km` : ''}
                          {ns.km && ns.datum ? ' / ' : ''}
                          {ns.datum ? new Date(`${ns.datum}T00:00:00`).toLocaleDateString('hr-HR') : ''}
                        </>
                      ) : '—'}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-slate-600">{v.napomena || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(event) => { event.stopPropagation(); openEdit(v); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600" aria-label="Uredi vozilo"><Pencil className="h-4 w-4" /></button>
                        <button onClick={(event) => { event.stopPropagation(); setDeleteId(v.id); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label="Obriši vozilo"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
          {sortedItems.map((v, index) => {
            const sb = statusBadge[displayStatus(v, todaysAssignments)];
            const warranty = jamstvoInfo({
              aktivno: v.jamstvo_aktivno ?? false,
              od: v.jamstvo_od,
              mjeseci: v.jamstvo_mjeseci,
              doVrijednosti: v.jamstvo_do_km,
              trenutnaVrijednost: v.kilometraza,
              jedinica: 'km',
            });
            return (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                onClick={() => openDetails(v)}
                onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openDetails(v); } }}
                className="group min-w-0 cursor-pointer rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <div className="mb-3 flex min-w-0 flex-col items-start justify-between gap-3 xl:flex-row">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
                      <Truck className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 leading-tight"><span className="mr-2 text-slate-400">{index + 1}.</span>{v.marka} {v.model}</h3>
                      <p className="mt-0.5 text-xs font-medium tracking-wide text-slate-500">{v.registracija}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(event) => { event.stopPropagation(); openEdit(v); }}
                      aria-label="Uredi vozilo"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-sky-600 transition-colors"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={(event) => { event.stopPropagation(); setDeleteId(v.id); }}
                      aria-label="Obriši vozilo"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="blue">{tipLabel[v.tip]}</Badge>
                  <Badge variant={sb.variant}>{sb.label}</Badge>
                  <Badge variant={warranty.tone}>{warranty.label}</Badge>
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
                  <span className="flex items-center gap-1.5">
                    <Weight className="h-3.5 w-3.5" />
                    Nosivost: {v.nosivost_kg ? `${v.nosivost_kg.toLocaleString('hr-HR')} kg` : '—'}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Weight className="h-3.5 w-3.5" />
                    Masa: {v.masa_kg ? `${v.masa_kg.toLocaleString('hr-HR')} kg` : '—'}
                  </span>
                </div>
                {warranty.detail && <p className="mt-2 text-xs text-slate-500">Jamstvo: {warranty.detail}</p>}
                {v.jamstvo_aktivno && v.jamstvo_uvjeti && <p className="mt-1 line-clamp-2 text-xs text-slate-500">Uvjeti jamstva: {v.jamstvo_uvjeti}</p>}

                {(() => {
                  const alert = servisAlert(v, servisi);
                  if (!alert) return null;
                  const cls = alert.level === 'overdue'
                    ? 'border-red-700 bg-red-600 text-white'
                    : alert.level === 'soon'
                      ? 'border-red-300 bg-red-100 text-red-800'
                      : 'border-slate-200 bg-slate-50 text-slate-600';
                  return (
                    <div className={`mt-3 flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${cls}`}>
                      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>{alert.text.charAt(0).toUpperCase() + alert.text.slice(1)}</span>
                    </div>
                  );
                })()}

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
        wide="screen"
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
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="min-w-0 space-y-4">
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
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
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
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
                <option value="neispravno">Neispravno</option>
              </Select>
            </Field>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <Field label="Kilometraža (km)">
              <TextInput
                type="number"
                min="0"
                step="1"
                value={form.kilometraza}
                onChange={(e) => setForm({ ...form, kilometraza: e.target.value })}
                placeholder="0"
              />
              <p className="mt-1 text-xs text-slate-500">Pri zaključenju naloga ažurira se prema završnim kilometrima zadnjeg korištenja vozila. Vrijednost možete ručno promijeniti.</p>
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
          <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
            <Field label="Nosivost (kg)">
              <TextInput type="number" min="0" value={form.nosivost_kg} onChange={(e) => setForm({ ...form, nosivost_kg: e.target.value })} placeholder="1000" />
            </Field>
            <Field label="Masa vozila (kg)">
              <TextInput type="number" min="0" value={form.masa_kg} onChange={(e) => setForm({ ...form, masa_kg: e.target.value })} placeholder="2000" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={form.u_rasporedu} onChange={(e) => setForm({ ...form, u_rasporedu: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
            Prikaži u dnevnom rasporedu
          </label>
          <Field label="Cijena po kilometru (EUR/km)">
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={form.cijena_km}
              onChange={(e) => setForm({ ...form, cijena_km: e.target.value })}
              placeholder="0,40"
            />
            {editing && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => void recalculateKm()}
                  disabled={recalculatingKm}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${recalculatingKm ? 'animate-spin' : ''}`} />
                  {recalculatingKm ? 'Obračunavam povijesne naloge…' : 'Ponovno obračunaj stare naloge'}
                </button>
                {kmRecalculationMessage && (
                  <p role="status" aria-live="polite" className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                    {kmRecalculationMessage}
                  </p>
                )}
              </div>
            )}
          </Field>
          <Field label="ENC (oznaka / broj uređaja)">
            <TextInput value={form.enc_broj} onChange={(e) => setForm({ ...form, enc_broj: e.target.value })} placeholder="npr. broj ENC uređaja" />
          </Field>
          <Field label="Napomena">
            <Textarea
              rows={2}
              value={form.napomena}
              onChange={(e) => setForm({ ...form, napomena: e.target.value })}
              placeholder="Servis, kvar, posebnosti…"
            />
          </Field>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">Upozorenje za servis</p>
            <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
              <Field label="Servis svakih (km)">
                <TextInput type="number" min="0" value={form.servis_interval_km} onChange={(e) => setForm({ ...form, servis_interval_km: e.target.value })} placeholder="npr. 15000" />
              </Field>
              <Field label="Servis svakih (mjeseci)">
                <TextInput type="number" min="0" value={form.servis_interval_mjeseci} onChange={(e) => setForm({ ...form, servis_interval_mjeseci: e.target.value })} placeholder="npr. 12" />
              </Field>
              <Field label="Upozori X km prije">
                <TextInput type="number" min="0" value={form.servis_upozorenje_km} onChange={(e) => setForm({ ...form, servis_upozorenje_km: e.target.value })} />
              </Field>
              <Field label="Upozori X dana prije">
                <TextInput type="number" min="0" value={form.servis_upozorenje_dana} onChange={(e) => setForm({ ...form, servis_upozorenje_dana: e.target.value })} />
              </Field>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">Računa se od zadnjeg upisanog servisa i trenutne kilometraže vozila. Ostavi prazno za isključeno.</p>
          </div>
          <Field label="Što treba napraviti na sljedećem servisu">
            <Textarea
              rows={4}
              value={form.sljedeci_servis_napomena}
              onChange={(e) => setForm((previous) => ({ ...previous, sljedeci_servis_napomena: e.target.value }))}
              placeholder={'npr. zamjena ulja i filtera\nprovjera kočnica\nprovjera guma'}
            />
            <p className="mt-1 text-xs text-slate-500">Popis ostaje uz vozilo dok ga ne promijeniš ili obrišeš.</p>
          </Field>
          <section className="space-y-3 rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={form.jamstvo_aktivno} onChange={(event) => setForm((previous) => ({ ...previous, jamstvo_aktivno: event.target.checked }))} className="h-4 w-4 rounded border-slate-300" />
              Vozilo ima jamstvo
            </label>
            {form.jamstvo_aktivno && <>
              <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
                <Field label="Početak jamstva"><TextInput type="date" value={form.jamstvo_od} onChange={(event) => setForm((previous) => ({ ...previous, jamstvo_od: event.target.value }))} /></Field>
                <Field label="Trajanje (mjeseci)"><TextInput type="number" min="1" step="1" value={form.jamstvo_mjeseci} onChange={(event) => setForm((previous) => ({ ...previous, jamstvo_mjeseci: event.target.value }))} placeholder="npr. 24" /></Field>
                <Field label="Jamstvo do kilometraže (km)"><TextInput type="number" min="0" step="1" value={form.jamstvo_do_km} onChange={(event) => setForm((previous) => ({ ...previous, jamstvo_do_km: event.target.value }))} placeholder="npr. 100000" /></Field>
              </div>
              <Field label="Dodatni uvjeti jamstva"><Textarea rows={2} value={form.jamstvo_uvjeti} onChange={(event) => setForm((previous) => ({ ...previous, jamstvo_uvjeti: event.target.value }))} placeholder="Ograničenja, obvezni servisi, što jamstvo pokriva…" /></Field>
            </>}
          </section>
          </div>
          {editing ? (
            <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
              <VoziloDokumenti voziloId={editing.id} onChange={() => void loadServisi()} />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">Povijest servisa, troškove i dokumente možeš dodati nakon prvog spremanja vozila.</p>
          )}
        </div>
      </Modal>

      {selectedVehicle && (
        <VoziloFleetDetalji
          vozilo={{ ...selectedVehicle, status: storedStatus(displayStatus(selectedVehicle, todaysAssignments)) }}
          onClose={() => setSelectedVehicle(null)}
          onEdit={() => { setSelectedVehicle(null); openEdit(selectedVehicle); }}
          onDataChange={() => { void loadServisi(); }}
        />
      )}

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
