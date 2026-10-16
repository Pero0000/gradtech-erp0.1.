import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { AuthContext, type AuthContextValue } from '@/auth/context';
import type { AppProfile } from '@/auth/profile';
import { type AppModule, type ModuleAction, type ModulePermissions } from '@/auth/permissions';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [permissions, setPermissions] = useState<ModulePermissions>({});
  const [sessionReady, setSessionReady] = useState(false);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      setSessionReady(true);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAccessError(error.message);
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
    if (!session?.user.id) {
      setProfile(null);
      setPermissions({});
      setAccessError(null);
      return;
    }

    setAccessLoading(true);
    setAccessError(null);
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('app_profiles')
        .select('id,email,approved,is_admin,radnik_id')
        .eq('id', session.user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profileData) throw new Error('Korisnički profil nije pronađen. Obratite se administratoru.');

      setProfile(profileData as AppProfile);
      if (!profileData.approved || !profileData.is_admin) {
        const { data, error } = await supabase
          .from('app_user_permissions')
          .select('module,can_view,can_edit')
          .eq('user_id', session.user.id);
        if (error) throw error;
        const nextPermissions: ModulePermissions = {};
        for (const permission of data ?? []) {
          nextPermissions[permission.module as AppModule] = {
            can_view: permission.can_view,
            can_edit: permission.can_edit,
          };
        }
        setPermissions(nextPermissions);
      } else {
        setPermissions({});
      }
    } catch (error) {
      setProfile(null);
      setPermissions({});
      setAccessError(error instanceof Error ? error.message : 'Ovlasti korisnika se nisu mogle učitati.');
    } finally {
      setAccessLoading(false);
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
    setPermissions({});
    setRecoveryMode(false);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    setRecoveryMode(false);
  }, []);

  const isAdmin = profile?.approved === true && profile.is_admin;
  const canAccess = useCallback((module: AppModule, action: ModuleAction = 'view') => {
    if (isAdmin) return true;
    if (!profile?.approved) return false;
    const permission = permissions[module];
    return action === 'edit'
      ? permission?.can_edit === true
      : permission?.can_view === true || permission?.can_edit === true;
  }, [isAdmin, permissions, profile?.approved]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    permissions,
    loading: !sessionReady || (accessLoading && !profile),
    accessError,
    recoveryMode,
    isAdmin,
    canAccess,
    refreshAccess,
    updatePassword,
    signOut,
  }), [session, profile, permissions, sessionReady, accessLoading, accessError, recoveryMode, isAdmin, canAccess, refreshAccess, updatePassword, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
