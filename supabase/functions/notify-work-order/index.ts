import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { importPKCS8, SignJWT } from 'https://esm.sh/jose@5.9.6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function googleAccessToken() {
  const email = Deno.env.get('FCM_SERVICE_ACCOUNT_EMAIL');
  const privateKey = Deno.env.get('FCM_SERVICE_ACCOUNT_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('Firebase service account nije konfiguriran.');

  const key = await importPKCS8(privateKey, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const result = await response.json();
  if (!response.ok || typeof result.access_token !== 'string') {
    throw new Error(`Firebase nije izdao pristupni token: ${result.error_description ?? response.statusText}`);
  }
  return result.access_token as string;
}

async function apnsProviderToken() {
  const keyId = Deno.env.get('APNS_KEY_ID');
  const teamId = Deno.env.get('APNS_TEAM_ID');
  const privateKey = Deno.env.get('APNS_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  if (!keyId || !teamId || !privateKey) throw new Error('Apple APNs ključ nije konfiguriran.');

  const key = await importPKCS8(privateKey, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(key);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return jsonResponse({ error: 'Authentication is required.' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error('Supabase function secrets nisu konfigurirani.');

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData.user) return jsonResponse({ error: 'Authentication is invalid.' }, 401);

    const serviceClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const [{ data: profile, error: profileError }, { data: permission, error: permissionError }] = await Promise.all([
      callerClient.from('app_profiles').select('approved,is_admin,company_id').eq('id', callerData.user.id).single(),
      callerClient.rpc('app_has_module_permission', { p_module: 'radni_nalozi', p_action: 'edit' }),
    ]);
    if (profileError) throw profileError;
    if (permissionError) throw permissionError;
    if (!profile.approved || permission !== true) {
      return jsonResponse({ error: 'You cannot distribute work orders.' }, 403);
    }

    const body = await request.json();
    const nalogId = typeof body.nalog_id === 'string' ? body.nalog_id : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nalogId)) {
      return jsonResponse({ error: 'A valid work order id is required.' }, 400);
    }

    const { data: nalog, error: nalogError } = await serviceClient
      .from('radni_nalozi')
      .select('id,broj,naslov,zakljucen_at,mobile_status,radni_nalozi_radnici(radnik_id)')
      .eq('id', nalogId)
      .eq('company_id', profile.company_id)
      .single();
    if (nalogError) throw nalogError;
    if (!nalog.zakljucen_at || nalog.mobile_status !== 'dodijeljen') {
      return jsonResponse({ error: 'The work order is not ready for distribution.' }, 409);
    }

    const workerIds = nalog.radni_nalozi_radnici.map((assignment: { radnik_id: string }) => assignment.radnik_id);
    if (!workerIds.length) return jsonResponse({ error: 'The work order has no assigned workers.' }, 409);
    const { data: profiles, error: workersError } = await serviceClient
      .from('app_profiles')
      .select('id,radnik_id')
      .eq('approved', true)
      .eq('company_id', profile.company_id)
      .in('radnik_id', workerIds);
    if (workersError) throw workersError;
    const userIds = (profiles ?? []).map((worker) => worker.id);
    if (!userIds.length) return jsonResponse({ sent: 0, failed: 0, reason: 'no_linked_accounts' });

    const { data: devices, error: devicesError } = await serviceClient
      .from('app_push_tokens')
      .select('user_id,token,platform')
      .eq('company_id', profile.company_id)
      .in('user_id', userIds);
    if (devicesError) throw devicesError;
    if (!devices?.length) return jsonResponse({ sent: 0, failed: 0, reason: 'no_registered_devices' });

    const projectId = Deno.env.get('FCM_PROJECT_ID');
    const bundleId = Deno.env.get('APNS_BUNDLE_ID');
    const apnsHost = Deno.env.get('APNS_USE_SANDBOX') === 'true'
      ? 'https://api.sandbox.push.apple.com'
      : 'https://api.push.apple.com';
    let fcmTokenPromise: Promise<string> | null = null;
    let appleTokenPromise: Promise<string> | null = null;
    const outcomes = await Promise.all(devices.map(async (device) => {
      try {
        if (device.platform === 'android') {
          if (!projectId) throw new Error('FCM_PROJECT_ID nije konfiguriran.');
          fcmTokenPromise ??= googleAccessToken();
          const fcmToken = await fcmTokenPromise;
          const response = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${fcmToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                token: device.token,
                notification: { title: 'Novi radni nalog', body: `${nalog.broj} · ${nalog.naslov}` },
                data: { nalog_id: nalog.id },
                android: { priority: 'high' },
              },
            }),
          });
          if (!response.ok) throw new Error(`FCM greška (${response.status}): ${await response.text()}`);
        } else {
          if (!bundleId) throw new Error('APNS_BUNDLE_ID nije konfiguriran.');
          appleTokenPromise ??= apnsProviderToken();
          const appleToken = await appleTokenPromise;
          const response = await fetch(`${apnsHost}/3/device/${device.token}`, {
            method: 'POST',
            headers: {
              authorization: `bearer ${appleToken}`,
              'apns-topic': bundleId,
              'apns-push-type': 'alert',
              'apns-priority': '10',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              aps: { alert: { title: 'Novi radni nalog', body: `${nalog.broj} · ${nalog.naslov}` }, sound: 'default' },
              nalog_id: nalog.id,
            }),
          });
          if (!response.ok) throw new Error(`APNs greška (${response.status}): ${await response.text()}`);
        }
        return { ok: true };
      } catch (reason) {
        return { ok: false, error: reason instanceof Error ? reason.message : String(reason) };
      }
    }));

    const sent = outcomes.filter((outcome) => outcome.ok).length;
    const failures = outcomes.filter((outcome) => !outcome.ok);
    return jsonResponse({ sent, failed: failures.length, errors: failures.map((failure) => failure.error) });
  } catch (reason) {
    return jsonResponse({ error: reason instanceof Error ? reason.message : 'Push notification failed.' }, 500);
  }
});
