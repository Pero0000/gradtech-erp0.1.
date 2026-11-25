import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase';

const PENDING_ORDER_KEY = 'gradtech:pending-push-order';
const PENDING_ORDER_OWNER_KEY = 'gradtech:pending-push-order-owner';
export const PUSH_REGISTRATION_KEY = 'gradtech:push-registration';

export interface ActivePushRegistration {
  userId: string;
  token: string;
  platform: 'android' | 'ios';
  installationProof: string;
}

let activeRegistration: ActivePushRegistration | null = null;

export function rememberPushRegistration(registration: ActivePushRegistration) {
  activeRegistration = registration;
  localStorage.setItem(PUSH_REGISTRATION_KEY, JSON.stringify(registration));
}

export function forgetPushRegistration(userId: string) {
  if (activeRegistration?.userId === userId) activeRegistration = null;
}

export async function unregisterCurrentPushRegistration() {
  const registration = activeRegistration;
  if (!registration || !Capacitor.isNativePlatform()) return;
  const { error } = await supabase.rpc('unregister_app_push_token', {
    p_token: registration.token,
    p_platform: registration.platform,
    p_installation_proof: registration.installationProof,
  });
  if (error) throw new Error(`Push registraciju nije moguće ukloniti: ${error.message}`);
  activeRegistration = null;
  localStorage.removeItem(PUSH_REGISTRATION_KEY);
}

export function getPushInstallationProof() {
  const key = 'gradtech:push-installation-proof';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const installationProof = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(key, installationProof);
  return installationProof;
}

export function storePendingPushOrder(userId: string, nalogId: string) {
  localStorage.setItem(PENDING_ORDER_KEY, nalogId);
  localStorage.setItem(PENDING_ORDER_OWNER_KEY, userId);
}

export function takePendingPushOrder(userId: string) {
  const owner = localStorage.getItem(PENDING_ORDER_OWNER_KEY);
  if (owner !== userId) return null;
  return localStorage.getItem(PENDING_ORDER_KEY);
}

export function clearPendingPushOrder(userId: string) {
  if (localStorage.getItem(PENDING_ORDER_OWNER_KEY) === userId) {
    localStorage.removeItem(PENDING_ORDER_KEY);
    localStorage.removeItem(PENDING_ORDER_OWNER_KEY);
  }
}
