import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return jsonResponse({ error: 'Prijava je potrebna za korištenje AI-ja.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  if (!supabaseUrl || !anonKey) return jsonResponse({ error: 'Supabase funkcija nije ispravno konfigurirana.' }, 500);
  if (!geminiKey) return jsonResponse({ error: 'Gemini API ključ još nije konfiguriran u Supabase Edge Function Secrets.' }, 503);

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return jsonResponse({ error: 'Prijava nije valjana.' }, 401);

  const { data: profile, error: profileError } = await callerClient
    .from('app_profiles')
    .select('approved,company_id')
    .eq('id', callerData.user.id)
    .single();
  if (profileError) return jsonResponse({ error: 'Nije moguće provjeriti pristup korisnika.' }, 500);
  if (!profile.approved || !profile.company_id) return jsonResponse({ error: 'Korisnik nema odobren pristup tvrtki.' }, 403);

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 24 * 1024 * 1024) return jsonResponse({ error: 'AI dokument je prevelik za slanje.' }, 413);

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return jsonResponse({ error: 'AI zahtjev nije valjan.' }, 400);
    }
    const { feature, request: geminiRequest } = body as { feature?: string; request?: unknown };
    const requiredPermissions = feature === 'assistant'
      ? [['asistent', 'view']]
      : feature === 'kooperant-invoice'
        ? [['kooperanti', 'edit'], ['troskovi', 'edit']]
        : feature === 'troskovnik-import'
          ? [['ponude', 'edit']]
          : null;
    if (!requiredPermissions || !geminiRequest || typeof geminiRequest !== 'object' || Array.isArray(geminiRequest)) {
      return jsonResponse({ error: 'AI zahtjev nije valjan.' }, 400);
    }

    for (const [module, action] of requiredPermissions) {
      const { data: allowed, error: permissionError } = await callerClient.rpc('app_has_module_permission', {
        p_module: module,
        p_action: action,
      });
      if (permissionError) return jsonResponse({ error: 'Nije moguće provjeriti AI ovlasti.' }, 500);
      if (allowed !== true) return jsonResponse({ error: 'Nemate ovlasti za ovu AI funkciju.' }, 403);
    }

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify(geminiRequest),
    });
    const responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : 'Greška pri povezivanju s Gemini servisom.';
    return jsonResponse({ error: message }, 500);
  }
});
