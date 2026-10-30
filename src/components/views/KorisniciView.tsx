import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, Save } from 'lucide-react';
import { MODULES, type AppModule } from '@/auth/permissions';
import { useAuth } from '@/auth/useAuth';
import type { AppProfile } from '@/auth/profile';
import { supabase } from '@/lib/supabase';
import { PozoviKorisnika } from './TvrtkeView';
import { fetchAllRows } from '@/lib/pagination';

type PermissionDraft = Record<AppModule, { can_view: boolean; can_edit: boolean }>;
interface ManagedUser extends AppProfile {
  permissions: PermissionDraft;
}

interface WorkerOption {
  id: string;
  ime: string;
  prezime: string;
  uloga: string;
}

function emptyPermissions(): PermissionDraft {
  return Object.fromEntries(MODULES.map(({ id }) => [id, { can_view: false, can_edit: false }])) as PermissionDraft;
}

export function KorisniciView() {
  const { profile: currentProfile } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voditeljSupported, setVoditeljSupported] = useState(true);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const loadProfiles = (columns: string) => fetchAllRows<AppProfile>((from, to) => supabase
        .from('app_profiles')
        .select(columns)
        .order('created_at', { ascending: true }).order('id').range(from, to) as unknown as PromiseLike<{ data: AppProfile[] | null; error: { message: string } | null }>);
      let profiles: AppProfile[];
      try {
        profiles = await loadProfiles('id,email,approved,is_admin,radnik_id,company_id,is_platform_owner,is_voditelj');
        setVoditeljSupported(true);
      } catch (reason) {
        if (!(reason && typeof reason === 'object' && 'message' in reason && /is_voditelj/i.test(String(reason.message)))) throw reason;
        profiles = (await loadProfiles('id,email,approved,is_admin,radnik_id,company_id,is_platform_owner'))
          .map((user) => ({ ...user, is_voditelj: user.radnik_id === null }));
        setVoditeljSupported(false);
      }

      const [permissionRows, workerRows] = await Promise.all([
        fetchAllRows<{ user_id: string; module: string; can_view: boolean; can_edit: boolean }>(
          (from, to) => supabase.from('app_user_permissions').select('user_id,module,can_view,can_edit')
            .order('user_id').order('module').range(from, to)),
        fetchAllRows<WorkerOption>((from, to) => supabase.from('radnici').select('id,ime,prezime,uloga')
          .order('ime').order('id').range(from, to)),
      ]);

      const permissionByUser = new Map<string, PermissionDraft>();
      for (const row of permissionRows) {
        const permissions = permissionByUser.get(row.user_id) ?? emptyPermissions();
        if (MODULES.some((module) => module.id === row.module)) {
          permissions[row.module as AppModule] = { can_view: row.can_view, can_edit: row.can_edit };
        }
        permissionByUser.set(row.user_id, permissions);
      }

      setUsers(profiles.map((user) => ({
        ...user,
        permissions: permissionByUser.get(user.id) ?? emptyPermissions(),
      })));
      setWorkers(workerRows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Korisnike nije moguće učitati.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const updateDraft = (userId: string, module: AppModule, field: 'can_view' | 'can_edit', checked: boolean) => {
    setUsers((existing) => existing.map((user) => {
      if (user.id !== userId) return user;
      const current = user.permissions[module];
      const next = { ...current, [field]: checked };
      if (field === 'can_edit' && checked) next.can_view = true;
      if (field === 'can_view' && !checked) next.can_edit = false;
      return { ...user, permissions: { ...user.permissions, [module]: next } };
    }));
  };

  const updateApproval = (userId: string, approved: boolean) => {
    setUsers((existing) => existing.map((user) => user.id === userId ? { ...user, approved } : user));
  };

  const updateWorker = (userId: string, radnikId: string) => {
    setUsers((existing) => existing.map((user) => user.id === userId ? { ...user, radnik_id: radnikId || null } : user));
  };

  const updateVoditelj = (userId: string, isVoditelj: boolean) => {
    setUsers((existing) => existing.map((user) => user.id === userId ? { ...user, is_voditelj: isVoditelj } : user));
  };

  const saveUser = async (user: ManagedUser) => {
    setSavingId(user.id);
    setError(null);
    setNotice(null);
    try {
      const { error: approvalError } = await supabase
        .from('app_profiles')
        .update(voditeljSupported
          ? { approved: user.approved, radnik_id: user.radnik_id, is_voditelj: user.is_voditelj }
          : { approved: user.approved, radnik_id: user.radnik_id })
        .eq('id', user.id);
      if (approvalError) throw approvalError;

      if (!user.is_admin) {
        const rows = MODULES.map(({ id }) => ({
          user_id: user.id,
          module: id,
          can_view: user.permissions[id].can_view,
          can_edit: user.permissions[id].can_edit,
        }));
        const { error: savePermissionsError } = await supabase
          .from('app_user_permissions')
          .upsert(rows, { onConflict: 'user_id,module' });
        if (savePermissionsError) throw savePermissionsError;
      }

      setNotice(`Prava za ${user.email} su spremljena.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Promjene korisnika nisu spremljene.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="min-w-0 max-w-full space-y-5 break-words">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Korisnici i prava</h1>
        <p className="mt-1 text-sm text-slate-600">Odobrite registracije i postavite zasebna prava pregleda i uređivanja za svaki modul.</p>
      </header>

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        Prikazani su samo korisnici vaše tvrtke. Pozvani djelatnici nemaju pristup modulima dok im ne dodijelite prava. Broj djelatnika nije ograničen.
      </div>
      {currentProfile && <div className="rounded-xl border border-slate-200 bg-white p-4"><PozoviKorisnika companyId={currentProfile.company_id} onInvited={() => void loadUsers()} /></div>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />Učitavanje korisnika…</div>
      ) : users.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">Još nema registriranih korisnika.</p>
      ) : (
        <div className="space-y-5">
          {users.map((user) => {
            const isCurrentUser = user.id === currentProfile?.id;
            return (
              <article key={user.id} className="min-w-0 max-w-full break-words rounded-xl border border-slate-200 bg-white">
                <div className="flex min-w-0 flex-col items-stretch justify-between gap-3 border-b border-slate-200 p-4 xl:flex-row xl:flex-wrap xl:items-center">
                  <div>
                    <h2 className="font-semibold text-slate-900">{user.email}</h2>
                    <p className="mt-1 text-xs text-slate-500">{user.is_admin ? user.radnik_id ? 'Administrator · Portal djelatnika' : 'Administrator' : !user.approved ? 'Čeka odobrenje' : user.is_voditelj || user.is_platform_owner ? user.radnik_id ? 'ERP moduli · Portal djelatnika' : 'Voditelj · ERP moduli' : 'Radnik · Portal djelatnika'}{isCurrentUser ? ' · Vaš račun' : ''}</p>
                  </div>
                  {user.is_admin && (
                    <div className="space-y-3 px-4 py-3">
                      <label className="block max-w-xl text-sm font-medium text-slate-700">
                        Djelatnik za Portal djelatnika
                        <select
                          value={user.radnik_id ?? ''}
                          onChange={(event) => updateWorker(user.id, event.target.value)}
                          className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">Nije povezan s djelatnikom</option>
                          {workers.map((worker) => (
                            <option
                              key={worker.id}
                              value={worker.id}
                              disabled={users.some((other) => other.id !== user.id && other.radnik_id === worker.id)}
                            >
                              {worker.ime} {worker.prezime} — {worker.uloga}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-xs text-slate-500">Poveži administratora s djelatnikom da se u ERP-u pojavi Portal djelatnika s njegovim dodijeljenim nalozima.</p>
                      <div className="flex justify-end">
                        <button type="button" disabled={savingId === user.id} onClick={() => void saveUser(user)} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60">
                          {savingId === user.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : notice?.includes(user.email) ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                          Spremi povezivanje
                        </button>
                      </div>
                    </div>
                  )}

                  {!user.is_admin && (
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input type="checkbox" checked={user.approved} onChange={(event) => updateApproval(user.id, event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                      Odobren pristup
                    </label>
                  )}
                  {user.is_admin && <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">Puna administratorska prava</span>}
                </div>

                {!user.is_admin && (
                  <>
                    <div className="border-b border-slate-200 px-4 py-3">
                      <label className="block max-w-xl text-sm font-medium text-slate-700">
                        Djelatnik za mobilni nalog
                        <select
                          value={user.radnik_id ?? ''}
                          onChange={(event) => updateWorker(user.id, event.target.value)}
                          className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">Nije povezan s djelatnikom</option>
                          {workers.map((worker) => (
                            <option
                              key={worker.id}
                              value={worker.id}
                              disabled={users.some((other) => other.id !== user.id && other.radnik_id === worker.id)}
                            >
                              {worker.ime} {worker.prezime} — {worker.uloga}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="mt-1 text-xs text-slate-500">Jedan korisnički račun može biti povezan samo s jednim djelatnikom i obrnuto.</p>
                      <label className="mt-3 flex items-start gap-2 text-sm font-medium text-slate-700">
                        <input type="checkbox" checked={user.is_voditelj} disabled={!voditeljSupported} onChange={(event) => updateVoditelj(user.id, event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                        <span>
                          Voditelj (pristup ERP modulima)
                          <span className="block text-xs font-normal text-slate-500">
                            {voditeljSupported
                              ? 'Oznaka omogućuje ERP pristup prema pravima modula. Ako je račun povezan s djelatnikom, korisnik zadržava i Portal djelatnika te može prebacivati između prikaza.'
                              : 'Pokreni migraciju 20261021110000_worker_portal.sql da bi oznaka bila dostupna.'}
                          </span>
                        </span>
                      </label>
                    </div>
                    <details className="group">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 [&::-webkit-details-marker]:hidden">
                        <span className="inline-flex items-center gap-2">
                          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                          Moduli i prava
                        </span>
                        <span className="text-xs font-normal text-slate-500">
                          Pregled: {MODULES.filter(({ id }) => user.permissions[id].can_view).length}/{MODULES.length}
                          {' · '}Uređivanje: {MODULES.filter(({ id }) => user.permissions[id].can_edit).length}/{MODULES.length}
                        </span>
                      </summary>
                    <div className="min-w-0 max-w-full overflow-x-auto">
                      <table className="w-full min-w-[600px] text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr><th className="px-4 py-2.5 font-semibold">Modul</th><th className="px-4 py-2.5 text-center font-semibold">Pregled</th><th className="px-4 py-2.5 text-center font-semibold">Uređivanje</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {MODULES.map(({ id, label }) => (
                            <tr key={id}>
                              <td className="px-4 py-2.5 text-slate-700">{label}</td>
                              <td className="px-4 py-2.5 text-center">
                                <input aria-label={`${label}: pregled`} type="checkbox" checked={user.permissions[id].can_view} onChange={(event) => updateDraft(user.id, id, 'can_view', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                              </td>
                              <td className="px-4 py-2.5 text-center">
                                <input aria-label={`${label}: uređivanje`} type="checkbox" checked={user.permissions[id].can_edit} onChange={(event) => updateDraft(user.id, id, 'can_edit', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    </details>
                    <div className="flex justify-end border-t border-slate-200 p-3">
                      <button type="button" disabled={savingId === user.id} onClick={() => void saveUser(user)} className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60">
                        {savingId === user.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : notice?.includes(user.email) ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                        Spremi prava
                      </button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
