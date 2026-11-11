import type { SetStateAction } from 'react';
import type { GradilisteZadatak, Oprema } from '@/types';
import {
  fetchNalogIzvrsenje, fetchNalogRadnikVrijeme, fetchNalogZadaci, fetchNalogStavke,
  fetchOprema, saveNalogInitialValues, type NalogRadnikVrijeme, type NalogStavka,
} from './api';

interface ExecutionState {
  error: string | null;
  zavrsen: boolean;
  bezIzvrsenja: boolean;
  teren: boolean;
  poslovodja: string | null;
  vozac: string | null;
  km: { pocetak: string; kraj: string };
  kmBezObracuna: boolean;
  napomena: string;
  vremena: NalogRadnikVrijeme[];
  zadaci: GradilisteZadatak[];
  stavke: NalogStavka[];
  alati: Oprema[];
  strojevi: Oprema[];
  savingTime: boolean;
  savingCompletion: boolean;
}

type Source = 'izvrsenje' | 'vremena' | 'zadaci' | 'stavke' | 'alati' | 'strojevi';
const sourceLabels: Record<Source, string> = {
  izvrsenje: 'Izvršenje naloga', vremena: 'Ekipa i vremena', zadaci: 'Zadaci',
  stavke: 'Materijal i oprema naloga', alati: 'Popis alata', strojevi: 'Popis strojeva',
};
const message = (reason: unknown) =>
  reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : String(reason);

function createExecution(nalogId: string) {
  let state: ExecutionState = {
    error: null,
    zavrsen: false, bezIzvrsenja: false, teren: false, poslovodja: null, vozac: null,
    km: { pocetak: '', kraj: '' }, kmBezObracuna: false, napomena: '',
    vremena: [], zadaci: [], stavke: [], alati: [], strojevi: [],
    savingTime: false, savingCompletion: false,
  };
  const listeners = new Set<() => void>();
  const loaded = new Set<Source>();
  const pending = new Map<Source, Promise<void>>();
  let defaultTimeIds: string[] = [];
  let defaultLeader: string | null = null;
  let defaultsPending: Promise<void> | null = null;
  let consumers = 0;
  let opened = false;
  const publish = (next: Partial<ExecutionState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  const sources: Record<Source, () => Promise<void>> = {
    izvrsenje: async () => {
      const value = await fetchNalogIzvrsenje(nalogId);
      publish({
        km: { pocetak: value.km_pocetak?.toString() ?? '', kraj: value.km_kraj?.toString() ?? '' },
        kmBezObracuna: Boolean(value.km_bez_obracuna), napomena: value.napomena ?? '',
        zavrsen: value.status === 'zavrsen', bezIzvrsenja: Boolean(value.bez_izvrsenja),
        teren: Boolean(value.teren), poslovodja: value.poslovodja_id ?? null, vozac: value.vozac_id ?? null,
      });
    },
    vremena: async () => {
      const rows = await fetchNalogRadnikVrijeme(nalogId);
      defaultTimeIds = rows.filter((row) => !row.mobile_zero_hours && !row.vrijeme_od).map((row) => row.radnik_id);
      publish({ vremena: rows.map((row) => row.mobile_zero_hours || row.vrijeme_od
        ? row : { ...row, vrijeme_od: '06:00:00' }) });
    },
    zadaci: async () => { publish({ zadaci: await fetchNalogZadaci(nalogId) }); },
    stavke: async () => { publish({ stavke: await fetchNalogStavke(nalogId) }); },
    alati: async () => {
      publish({ alati: (await fetchOprema('alat')).filter((item) => item.status !== 'servis' && item.status !== 'neaktivno') });
    },
    strojevi: async () => {
      publish({ strojevi: (await fetchOprema('stroj')).filter((item) => item.status !== 'servis' && item.status !== 'neaktivno') });
    },
  };
  const loadSource = (source: Source, refresh: boolean): Promise<void> => {
    const active = pending.get(source);
    if (active) return active;
    if (!refresh && loaded.has(source)) return Promise.resolve();
    const request = sources[source]().then(() => { loaded.add(source); })
      .catch((reason: unknown) => { throw new Error(`${sourceLabels[source]}: ${message(reason)}`); })
      .finally(() => { pending.delete(source); });
    pending.set(source, request);
    return request;
  };
  return {
    getSnapshot: () => state,
    retain() {
      if (consumers === 0 && opened) loaded.clear();
      opened = true;
      consumers += 1;
      return () => { consumers -= 1; };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    field<K extends keyof ExecutionState>(snapshot: ExecutionState, key: K): [
      ExecutionState[K], (next: SetStateAction<ExecutionState[K]>) => void,
    ] {
      return [snapshot[key], (next) => {
        publish({ [key]: typeof next === 'function' ? next(state[key]) : next });
      }];
    },
    timeSavePending: { current: false },
    async load(refresh = false) {
      const results = await Promise.allSettled((Object.keys(sources) as Source[]).map((source) => loadSource(source, refresh)));
      if (loaded.has('izvrsenje') && loaded.has('vremena') && !state.poslovodja && state.vremena.length === 1) {
        defaultLeader = state.vremena[0].radnik_id;
        publish({ poslovodja: defaultLeader });
      }
      const errors = results.flatMap((result) => result.status === 'rejected' ? [message(result.reason)] : []);
      publish({ error: errors.length ? errors.join('\n') : null });
      if (errors.length) throw new Error(errors.join('\n'));
    },
    persistDefaults(): Promise<void> {
      if (defaultsPending) return defaultsPending;
      const radnikIds = defaultTimeIds.filter((id) => state.vremena.some((row) =>
        row.radnik_id === id && !row.mobile_zero_hours && row.vrijeme_od === '06:00:00'));
      const poslovodjaId = state.poslovodja === defaultLeader ? defaultLeader : null;
      if (radnikIds.length === 0 && !poslovodjaId) return Promise.resolve();
      defaultsPending = saveNalogInitialValues(nalogId, radnikIds, poslovodjaId).then(() => {
        defaultTimeIds = [];
        defaultLeader = null;
      }).finally(() => { defaultsPending = null; });
      return defaultsPending;
    },
  };
}

export function createNalogExecutionCache() {
  const entries = new Map<string, ReturnType<typeof createExecution>>();
  return {
    get(id: string) {
      let entry = entries.get(id);
      if (!entry) {
        entry = createExecution(id);
        entries.set(id, entry);
      }
      return entry;
    },
    invalidate() { entries.clear(); },
  };
}

export type NalogExecutionCache = ReturnType<typeof createNalogExecutionCache>;
