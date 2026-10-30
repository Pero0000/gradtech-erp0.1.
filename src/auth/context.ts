import { createContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { AppProfile } from '@/auth/profile';
import type { AppModule, ModuleAction, ModulePermissions } from '@/auth/permissions';
import type { Tvrtka } from '@/lib/company';

export interface AuthContextValue {
  session: Session | null;
  profile: AppProfile | null;
  permissions: ModulePermissions;
  loading: boolean;
  accessError: string | null;
  recoveryMode: boolean;
  isAdmin: boolean;
  isPlatformOwner: boolean;
  /** Radnik bez ERP uloge — vidi samo Portal djelatnika. */
  isWorker: boolean;
  hasWorkerPortal: boolean;
  company: Tvrtka | null;
  canAccess: (module: AppModule, action?: ModuleAction) => boolean;
  refreshAccess: () => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
