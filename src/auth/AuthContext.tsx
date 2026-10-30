import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { AuthContext, type AuthContextValue } from '@/auth/context';
import type { AppProfile } from '@/auth/profile';
import { type AppModule, type ModuleAction, type ModulePermissions } from '@/auth/permissions';
import { normalizeTvrtkaPostavke, setCurrentCompany, type Tvrtka } from '@/lib/company';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [permissions, setPermissions] = useState<ModulePermissions>({});
  const [sessionReady, setSessionReady] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [company, setCompany] = useState<Tvrtka | null>(null);
  const accessVersion = useRef(0);
  const currentUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (currentUserId.current !== (nextSession?.user.id ?? null)) {
        currentUserId.current = nextSession?.user.id ?? null;
        accessVersion.current += 1;
        setProfile(null);
        setPermissions({});
        setCompany(null);
        setCurrentCompany(null);
        setAccessLoading(false);
        setAccessError(null);
        if (!nextSession) setRecoveryMode(false);
      }
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      if (nextSession?.user.user_metadata.gradtech_set_password === true) setRecoveryMode(true);
      setSessionReady(true);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAccessError(error.message);
      currentUserId.current = data.session?.user.id ?? null;
      if (data.session?.user.user_metadata.gradtech_set_password === true) setRecoveryMode(true);
      setSession(data.session);
      setSessionReady(true);
    }).catch((error: unknown) => {
      if (active) {
        setAccessError(error instanceof Error ? error.message : 'Prijava se nije mogla provjeriti.');
        setSessionReady(true);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const refreshAccess = useCallback(async () => {
    const version = ++accessVersion.current;
    if (!session?.user.id) {
      setProfile(null);
      setPermissions({});
      setAccessError(null);
      setCompany(null);
      setCurrentCompany(null);
      setAccessLoading(false);
      return;
    }

    setAccessLoading(true);
    setAccessError(null);
    try {
      const profileQuery = (columns: string) => supabase
        .from('app_profiles')
        .select(columns)
        .eq('id', session.user.id)
        .maybeSingle<AppProfile>();
      let { data: profileData, error: profileError } = await profileQuery('id,email,approved,is_admin,radnik_id,company_id,is_platform_owner,is_voditelj');
      if (profileError && /is_voditelj/i.test(profileError.message)) {
        // Migracija portala djelatnika još nije pokrenuta: računi bez radnika ostaju uredski.
        ({ data: profileData, error: profileError } = await profileQuery('id,email,approved,is_admin,radnik_id,company_id,is_platform_owner'));
        if (profileData) profileData = { ...profileData, is_voditelj: profileData.radnik_id === null };
      }
      if (profileError) throw profileError;
      if (!profileData) throw new Error('Korisnički profil nije pronađen. Obratite se administratoru.');

      const { data: companyData, error: companyError } = await supabase
        .from('tvrtke')
        .select('id,naziv,oib,adresa,aktivna,postavke')
        .eq('id', profileData.company_id)
        .single();
      if (companyError) throw companyError;
      if (!companyData.aktivna) throw new Error('Vaša tvrtka nije aktivna. Obratite se vlasniku sustava.');
      const companyWithSettings = {
        ...companyData,
        postavke: normalizeTvrtkaPostavke(companyData.postavke),
      };
      const nextPermissions: ModulePermissions = {};
      if (!profileData.approved || !profileData.is_admin) {
        const { data, error } = await supabase
          .from('app_user_permissions')
          .select('module,can_view,can_edit')
          .eq('user_id', session.user.id);
        if (error) throw error;
        for (const permission of data ?? []) {
          nextPermissions[permission.module as AppModule] = {
            can_view: permission.can_view,
            can_edit: permission.can_edit,
          };
        }
      }
      if (version !== accessVersion.current) return;
      setCurrentCompany(companyWithSettings);
      setCompany(companyWithSettings);
      setProfile(profileData as AppProfile);
      setPermissions(nextPermissions);
    } catch (error) {
      if (version !== accessVersion.current) return;
      setProfile(null);
      setCompany(null);
      setCurrentCompany(null);
      setPermissions({});
      setAccessError(error instanceof Error ? error.message : 'Ovlasti korisnika se nisu mogle učitati.');
    } finally {
      if (version === accessVersion.current) setAccessLoading(false);
    }
  }, [session?.user.id]);

  useEffect(() => {
    if (!sessionReady) return;
    void refreshAccess();
  }, [refreshAccess, sessionReady]);

  useEffect(() => {
    if (!sessionReady || !session?.user.id) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshAccess();
    };
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshAccess, session?.user.id, sessionReady]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
    setCompany(null);
    setCurrentCompany(null);
    setPermissions({});
    setRecoveryMode(false);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password, data: { gradtech_set_password: false } });
    if (error) throw error;
    setRecoveryMode(false);
  }, []);

  const isAdmin = profile?.approved === true && profile.is_admin;
  const isPlatformOwner = profile?.approved === true && profile.is_platform_owner;
  const isWorker = profile?.approved === true && !profile.is_admin && !profile.is_voditelj && !profile.is_platform_owner;
  const hasWorkerPortal = profile?.approved === true && profile.radnik_id !== null;
  const canAccess = useCallback((module: AppModule, action: ModuleAction = 'view') => {
    if (company?.postavke.disabled_modules.includes(module)) return false;
    if (isAdmin) return true;
    if (!profile?.approved || isWorker) return false;
    const permission = permissions[module];
    return action === 'edit'
      ? permission?.can_edit === true
      : permission?.can_view === true || permission?.can_edit === true;
  }, [company, isAdmin, isWorker, permissions, profile?.approved]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    permissions,
    loading: !sessionReady || (Boolean(session) && !profile && !accessError) || (accessLoading && !profile),
    accessError,
    recoveryMode,
    isAdmin,
    isPlatformOwner,
    isWorker,
    hasWorkerPortal,
    company,
    canAccess,
    refreshAccess,
    updatePassword,
    signOut,
  }), [session, profile, permissions, sessionReady, accessLoading, accessError, recoveryMode, isAdmin, isPlatformOwner, isWorker, hasWorkerPortal, company, canAccess, refreshAccess, updatePassword, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
