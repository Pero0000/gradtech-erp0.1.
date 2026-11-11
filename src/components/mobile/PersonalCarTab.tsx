import { useEffect, useRef, useState } from 'react';
import { Car, Plus, RefreshCw } from 'lucide-react';
import {
  cancelPersonalCarTrip, fetchPersonalCarOptions, fetchPersonalCarTrips, reportPersonalCarTrip, rememberPersonalCarVehicle,
  type PersonalCarOptions, type PersonalCarTrip,
} from '@/lib/personalCar';
import { formatHrDate } from '@/lib/localization';
import { todayISO } from '@/lib/rokovi';

const inputClass = 'mt-1 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base';
const money = (value: number) => value.toLocaleString('hr-HR', { style: 'currency', currency: 'EUR' });
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : 'Vožnju nije moguće spremiti.';

export function PersonalCarTab() {
  const [options, setOptions] = useState<PersonalCarOptions>({ vozila: [], gradilista: [], zadnje_vozilo_id: null });
  const [trips, setTrips] = useState<PersonalCarTrip[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [startKm, setStartKm] = useState('');
  const [endKm, setEndKm] = useState('');
  const [destination, setDestination] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [workStart, setWorkStart] = useState('');
  const [workEnd, setWorkEnd] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const busy = useRef(false);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setReady(false);
    setError(null);
    void Promise.all([fetchPersonalCarOptions(), fetchPersonalCarTrips()])
      .then(([nextOptions, nextTrips]) => {
        if (!active) return;
        setOptions(nextOptions);
        setTrips(nextTrips);
        setHasMore(nextTrips.length === 30);
        const vehicle = nextOptions.vozila.find((item) => item.id === nextOptions.zadnje_vozilo_id);
        setVehicleId(vehicle?.id ?? '');
        setStartKm(vehicle ? String(vehicle.kilometraza) : '');
        setReady(true);
      })
      .catch((reason: unknown) => { if (active) setError(errorText(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);

  const vehicle = options.vozila.find((item) => item.id === vehicleId);
  const distance = endKm.trim() && startKm.trim() ? Number(endKm) - Number(startKm) : 0;
  const business = destination !== '' && destination !== 'privatno';
  const rate = Number(vehicle?.cijena_km ?? 0);
  const estimatedCost = Math.round(distance * rate * 100) / 100;

  const refresh = async () => {
    const [nextOptions, nextTrips] = await Promise.all([fetchPersonalCarOptions(), fetchPersonalCarTrips()]);
    setOptions(nextOptions);
    setTrips(nextTrips);
    setHasMore(nextTrips.length === 30);
    return nextOptions;
  };

  const selectVehicle = async (id: string) => {
    if (busy.current) return;
    const selected = options.vozila.find((item) => item.id === id);
    setVehicleId(id);
    setStartKm(selected ? String(selected.kilometraza) : '');
    setEndKm('');
    if (!selected) return;
    busy.current = true;
    setSelecting(true);
    setError(null);
    try { await rememberPersonalCarVehicle(id); } catch (reason) {
      setError(`Odabrani auto nije zapamćen: ${errorText(reason)}`);
    } finally { busy.current = false; setSelecting(false); }
  };

  const save = async () => {
    if (busy.current) return;
    if (!vehicle || !destination || (business && !options.gradilista.some((site) => site.id === destination))
      || !date || date > todayISO() || !startKm.trim() || !endKm.trim()
      || !Number.isInteger(Number(startKm)) || Number(startKm) < 0
      || !Number.isInteger(Number(endKm)) || Number(endKm) > 2147483647 || distance <= 0
      || Boolean(startTime) !== Boolean(endTime)
      || (business && (!workStart || !workEnd || workStart === workEnd))) {
      setError('Odaberite auto, gradilište ili privatnu vožnju, datum do danas i valjane početne i završne kilometre. Vrijeme vožnje unesite u oba polja ili ga ostavite prazno; za gradilište obavezno unesite početak i završetak rada.');
      return;
    }
    if (business && (!Number.isFinite(rate) || rate <= 0)) {
      setError('Vozilo nema cijenu po kilometru. Ured treba postaviti cijenu prije poslovne vožnje.');
      return;
    }
    const input = {
      vozilo_id: vehicle.id, datum: date, km_pocetak: Number(startKm), km_kraj: Number(endKm),
      gradiliste_id: business ? destination : null, vrijeme_od: startTime || null, vrijeme_do: endTime || null,
      radno_vrijeme_od: business ? workStart : null, radno_vrijeme_do: business ? workEnd : null,
      napomena: note.trim(),
    };
    const payload = JSON.stringify(input);
    if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
    busy.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await reportPersonalCarTrip({ ...input, id: request.current.id });
      request.current = null;
      setNotice(business ? 'Vožnja, radno vrijeme i trošak gradilišta su spremljeni.' : 'Privatna vožnja je spremljena bez troška gradilišta i radnog vremena.');
      setStartKm(endKm);
      setEndKm('');
      setStartTime('');
      setEndTime('');
      setWorkStart('');
      setWorkEnd('');
      setNote('');
      try {
        const nextOptions = await refresh();
        const updated = nextOptions.vozila.find((item) => item.id === vehicle.id);
        if (updated) setStartKm(String(updated.kilometraza));
      } catch (reason) {
        setError(`Vožnja je spremljena, ali prikaz nije osvježen: ${errorText(reason)}`);
      }
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (busy.current || !cancelId) return;
    if (!cancelReason.trim()) { setError('Upišite razlog storna.'); return; }
    busy.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await cancelPersonalCarTrip(cancelId, cancelReason.trim());
      setCancelId(null);
      setCancelReason('');
      setNotice('Vožnja je stornirana. Povezani trošak gradilišta je poništen, ali već evidentirano radno vrijeme ostaje u obračunu i povijesti.');
      try { await refresh(); } catch (reason) {
        setError(`Storno je spremljen, ali povijest nije osvježena: ${errorText(reason)}`);
      }
    } catch (reason) { setError(errorText(reason)); } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || busy.current || !trips.length) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchPersonalCarTrips(trips[trips.length - 1]);
      setTrips((current) => [...new Map([...current, ...page].map((trip) => [trip.id, trip])).values()]);
      setHasMore(page.length === 30);
    } catch (reason) { setError(errorText(reason)); } finally { setLoadingMore(false); }
  };

  return (
    <div className="space-y-4">
      {error && <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        <p>{error}</p>
        <button type="button" disabled={saving || selecting || loadingMore || loading} onClick={() => setReload((current) => current + 1)}
          className="font-semibold underline disabled:opacity-50">Ponovno učitaj</button>
      </div>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
      {loading ? <p className="rounded-xl bg-white p-4 text-sm text-slate-500">Učitavanje osobnog auta…</p> : ready && (
        <>
          <section className="rounded-2xl border border-sky-200 bg-white p-4">
            <h3 className="flex items-center gap-2 font-bold text-slate-900"><Car className="h-5 w-5 text-sky-700" /> Prijavi vožnju</h3>
            <p className="mt-1 text-xs text-slate-500">Službeni auto koji koristiš. Zadnji odabrani auto pamti se i na drugim uređajima.</p>
            <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <fieldset disabled={saving || selecting || loadingMore} className="min-w-0 space-y-3">
                <label className="block text-sm font-medium text-slate-700">Auto
                  <select required value={vehicleId} onChange={(event) => { void selectVehicle(event.target.value); }} className={inputClass}>
                    <option value="">Odaberi auto</option>
                    {options.vozila.map((item) => <option key={item.id} value={item.id}>{item.naziv}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">Gradilište / privatno
                  <select required value={destination} onChange={(event) => setDestination(event.target.value)} className={inputClass}>
                    <option value="">Odaberi svrhu vožnje</option>
                    <option value="privatno">Privatno — bez troška gradilišta</option>
                    {options.gradilista.map((site) => <option key={site.id} value={site.id}>{site.naziv}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">Datum
                  <input required lang="hr-HR" type="date" max={todayISO()} value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
                </label>
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  <label className="block text-sm font-medium text-slate-700">Početni kilometri
                    <input required type="number" min="0" max="2147483646" step="1" value={startKm} onChange={(event) => setStartKm(event.target.value)} className={inputClass} />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">Završni kilometri
                    <input required type="number" min="1" max="2147483647" step="1" value={endKm} onChange={(event) => setEndKm(event.target.value)} className={inputClass} />
                  </label>
                </div>
                <div className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">
                  <p className="font-bold">{distance > 0 ? distance.toLocaleString('hr-HR') : '—'} km</p>
                  {business ? <p>{rate > 0 ? `${rate.toLocaleString('hr-HR')} €/km · procjena troška ${money(Math.max(0, estimatedCost))}` : 'U vozilu nije postavljena cijena/km.'}</p>
                    : <p>{destination === 'privatno' ? 'Privatna vožnja ne tereti gradilište.' : 'Odaberi svrhu za prikaz obračuna.'}</p>}
                  {business && <p className="mt-1 text-xs">Unesena smjena upisuje se u evidenciju radnog vremena i obračun.</p>}
                </div>
                {business && <div className="rounded-xl border border-sky-100 bg-sky-50 p-3">
                  <p className="text-sm font-bold text-slate-800">Radno vrijeme na gradilištu</p>
                  <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
                    <label className="block text-sm">Početak rada<input required type="time" value={workStart} onChange={(event) => setWorkStart(event.target.value)} className={inputClass} /></label>
                    <label className="block text-sm">Završetak rada<input required type="time" value={workEnd} onChange={(event) => setWorkEnd(event.target.value)} className={inputClass} /></label>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">Ako rad završava nakon ponoći, unesite vrijeme završetka sljedećeg dana. Sati već evidentirani na radnom nalogu ne smiju se prijaviti ponovno.</p>
                </div>}
                <details className="text-sm text-slate-600">
                  <summary className="cursor-pointer py-1">Vrijeme vožnje i {business ? 'razlog puta' : 'napomena'} (neobavezno)</summary>
                  <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
                    <label className="block">Polazak<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className={inputClass} /></label>
                    <label className="block">Dolazak<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className={inputClass} /></label>
                  </div>
                  <p className="mt-1 text-xs">Samo informacija o vožnji; dolazak može biti sljedeći dan.</p>
                  <label className="mt-2 block">{business ? 'Razlog puta' : 'Napomena'}<textarea value={note} maxLength={1000} rows={2} onChange={(event) => setNote(event.target.value)} className={`${inputClass} py-2`} /></label>
                </details>
                <p className="text-xs text-amber-800">Ne prijavljuj kilometre ni radno vrijeme koji se već obračunavaju preko radnog naloga.</p>
                <button type="submit" disabled={!options.vozila.length}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 font-bold text-white disabled:opacity-50">
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {saving ? 'Spremanje…' : 'Spremi vožnju'}
                </button>
              </fieldset>
            </form>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="mb-3 font-semibold text-slate-900">Moje vožnje</h3>
            {!trips.length && <p className="py-3 text-center text-sm text-slate-500">Još nema prijavljenih vožnji.</p>}
            <div className="space-y-3">
              {trips.map((trip) => (
                <article key={trip.id} className={`rounded-xl border p-3 ${trip.stornirano_at ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-sm font-bold text-slate-900">{trip.kilometri.toLocaleString('hr-HR')} km · {trip.gradiliste_naziv ?? 'Privatno'}</span>
                    <span className="text-xs text-slate-500">{formatHrDate(new Date(`${trip.datum}T00:00:00`))}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{trip.vozilo_naziv}</p>
                  <p className="text-xs text-slate-500">{trip.km_pocetak.toLocaleString('hr-HR')} → {trip.km_kraj.toLocaleString('hr-HR')} km</p>
                  {trip.vrijeme_od && <p className="text-xs text-slate-500">Vožnja {trip.vrijeme_od.slice(0, 5)} – {trip.vrijeme_do?.slice(0, 5)}</p>}
                  {trip.radno_vrijeme_od && <p className="text-xs text-slate-600">Rad {trip.radno_vrijeme_od.slice(0, 5)} – {trip.radno_vrijeme_do?.slice(0, 5)}{trip.radno_vrijeme_do && trip.radno_vrijeme_do < trip.radno_vrijeme_od ? ' · završetak sljedeći dan' : ''} · evidentirano u radnom vremenu</p>}
                  {trip.napomena && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">{trip.napomena}</p>}
                  {trip.stornirano_at ? <p className="mt-2 text-xs font-medium text-rose-700">Stornirano · {trip.razlog_storna}</p>
                    : <p className="mt-2 text-xs font-semibold text-sky-800">{trip.gradiliste_id ? `Trošak gradilišta: ${money(trip.iznos)}` : 'Privatno · bez troška gradilišta'}</p>}
                  {!trip.stornirano_at && cancelId !== trip.id && <button type="button" disabled={saving || selecting || loadingMore} onClick={() => { setCancelId(trip.id); setCancelReason(''); }}
                    className="mt-2 text-xs text-slate-500 underline disabled:opacity-50">Pogrešan unos? Storniraj</button>}
                  {cancelId === trip.id && <div className="mt-2 space-y-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-900">
                    <p>Storno zadržava zapis, a trošak gradilišta svodi na 0 €. Već evidentirano radno vrijeme ostaje u obračunu; zatim možeš prijaviti ispravnu vožnju.</p>
                    <label className="block">Razlog storna<input maxLength={500} value={cancelReason} disabled={saving} onChange={(event) => setCancelReason(event.target.value)} className={inputClass} /></label>
                    <div className="flex gap-3">
                      <button type="button" disabled={saving || selecting || loadingMore || !cancelReason.trim()} onClick={() => void cancel()} className="font-bold disabled:opacity-50">Potvrdi storno</button>
                      <button type="button" disabled={saving} onClick={() => setCancelId(null)}>Odustani</button>
                    </div>
                  </div>}
                </article>
              ))}
            </div>
            {hasMore && <button type="button" disabled={loadingMore || saving || selecting} onClick={() => void loadMore()} className="mt-3 min-h-10 text-sm font-semibold text-sky-700 disabled:opacity-50">
              {loadingMore ? 'Učitavanje…' : 'Učitaj starije vožnje'}
            </button>}
          </section>
        </>
      )}
    </div>
  );
}
