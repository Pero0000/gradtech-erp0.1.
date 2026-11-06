import { supabase } from './supabase';

export interface PersonalCarOptions {
  zadnje_vozilo_id: string | null;
  vozila: Array<{ id: string; naziv: string; kilometraza: number; cijena_km: number | null }>;
  gradilista: Array<{ id: string; naziv: string }>;
}

export interface PersonalCarTripInput {
  id: string;
  vozilo_id: string;
  datum: string;
  km_pocetak: number;
  km_kraj: number;
  gradiliste_id: string | null;
  vrijeme_od: string | null;
  vrijeme_do: string | null;
  napomena: string;
}

export interface PersonalCarTrip extends PersonalCarTripInput {
  vozilo_naziv: string;
  gradiliste_naziv: string | null;
  kilometri: number;
  cijena_km: number;
  iznos: number;
  trosak_id: string | null;
  created_at: string;
  stornirano_at: string | null;
  razlog_storna: string | null;
}

function tripError(error: { message: string; code?: string }) {
  if (['42883', '42P01', 'PGRST202', 'PGRST205'].includes(error.code ?? '')) {
    return new Error('Osobni auto zahtijeva migraciju 20261110420000_osobni_auto_pilot.sql. Obratite se administratoru.');
  }
  return new Error(error.message);
}

export async function fetchPersonalCarAccess(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_my_personal_car');
  if (error) throw tripError(error);
  if (typeof data !== 'boolean') throw new Error('Provjera pristupa osobnom autu nije potvrđena.');
  return data;
}

export async function fetchPersonalCarOptions(): Promise<PersonalCarOptions> {
  const { data, error } = await supabase.rpc('get_my_personal_car_options');
  if (error) throw tripError(error);
  return data as PersonalCarOptions;
}

export async function fetchPersonalCarTrips(before?: Pick<PersonalCarTrip, 'created_at' | 'id'>): Promise<PersonalCarTrip[]> {
  const { data, error } = await supabase.rpc('get_my_personal_car_trips', {
    p_before_time: before?.created_at ?? null,
    p_before_id: before?.id ?? null,
  });
  if (error) throw tripError(error);
  return (data ?? []) as PersonalCarTrip[];
}

export async function reportPersonalCarTrip(input: PersonalCarTripInput): Promise<string> {
  const { data, error } = await supabase.rpc('report_my_personal_car_trip', {
    p_id: input.id,
    p_vozilo_id: input.vozilo_id,
    p_datum: input.datum,
    p_km_pocetak: input.km_pocetak,
    p_km_kraj: input.km_kraj,
    p_gradiliste_id: input.gradiliste_id,
    p_vrijeme_od: input.vrijeme_od,
    p_vrijeme_do: input.vrijeme_do,
    p_napomena: input.napomena,
  });
  if (error) throw tripError(error);
  if (typeof data !== 'string' || data !== input.id) {
    throw new Error('Spremanje vožnje nije potvrđeno. Ponovno pokušajte bez mijenjanja unosa.');
  }
  return data;
}

export async function cancelPersonalCarTrip(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_my_personal_car_trip', { p_id: id, p_razlog: reason });
  if (error) throw tripError(error);
}

export async function rememberPersonalCarVehicle(id: string): Promise<void> {
  const { error } = await supabase.rpc('remember_my_personal_car_vehicle', { p_vozilo_id: id });
  if (error) throw tripError(error);
}
