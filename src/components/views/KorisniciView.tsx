import { useCallback, useEffect, useState } from 'react';
import { Check, LoaderCircle, Save } from 'lucide-react';
import { MODULES, type AppModule } from '@/auth/permissions';
import { useAuth } from '@/auth/useAuth';
import type { AppProfile } from '@/auth/profile';
import { supabase } from '@/lib/supabase';

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

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: profiles, error: profileError } = await supabase
        .from('app_profiles')
        .select('id,email,approved,is_admin,radnik_id')
        .order('created_at', { ascending: true });
      if (profileError) throw profileError;

      const [permissionsResult, workersResult] = await Promise.all([
        supabase.from('app_user_permissions').select('user_id,module,can_view,can_edit'),
        supabase.from('radnici').select('id,ime,prezime,uloga').order('ime'),
      ]);
      if (permissionsResult.error) throw permissionsResult.error;
      if (workersResult.error) throw workersResult.error;

      const permissionByUser = new Map<string, PermissionDraft>();
      for (const row of permissionsResult.data ?? []) {
        const permissions = permissionByUser.get(row.user_id) ?? emptyPermissions();
        if (MODULES.some((module) => module.id === row.module)) {
          permissions[row.module as AppModule] = { can_view: row.can_view, can_edit: row.can_edit };
        }
        permissionByUser.set(row.user_id, permissions);
      }

      setUsers((profiles ?? []).map((user) => ({
        ...user as AppProfile,
        permissions: permissionByUser.get(user.id) ?? emptyPermissions(),
      })));
      setWorkers((workersResult.data ?? []) as WorkerOption[]);
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

  const saveUser = async (user: ManagedUser) => {
    setSavingId(user.id);
    setError(null);
    setNotice(null);
    try {
      const { error: approvalError } = await supabase
        .from('app_profiles')
        .update({ approved: user.approved, radnik_id: user.radnik_id })
        .eq('id', user.id);
      if (approvalError) throw approvalError;

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

      setNotice(`Prava za ${user.email} su spremljena.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Promjene korisnika nisu spremljene.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Korisnici i prava</h1>
        <p className="mt-1 text-sm text-slate-600">Odobrite registracije i postavite zasebna prava pregleda i uređivanja za svaki modul.</p>
      </header>

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
        Novi računi nemaju pristup poslovnim podacima dok ih ne odobrite i spremite im prava.
      </div>
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
              <article key={user.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
                  <div>
                    <h2 className="font-semibold text-slate-900">{user.email}</h2>
                    <p className="mt-1 text-xs text-slate-500">{user.is_admin ? 'Administrator' : user.approved ? 'Odobren račun' : 'Čeka odobrenje'}{isCurrentUser ? ' · Vaš račun' : ''}</p>
                  </div>
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
                    </div>
                    <div className="overflow-x-auto">
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
