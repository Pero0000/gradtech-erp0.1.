import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return response({ error: 'Metoda nije dopuštena.' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) throw new Error('Nedostaje konfiguracija Supabase funkcije.');
    const authorization = request.headers.get('Authorization');
    if (!authorization) return response({ error: 'Potrebna je prijava.' }, 401);
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await caller.auth.getUser();
    if (authError || !auth.user) return response({ error: 'Prijava nije valjana.' }, 401);
    const { data: profile, error: profileError } = await caller.from('app_profiles')
      .select('id,company_id,approved,is_admin,is_platform_owner').eq('id', auth.user.id).single();
    if (profileError) throw profileError;
    const { data: activeCompany, error: companyError } = await caller.rpc('app_current_company_id');
    if (companyError) throw companyError;
    if (!profile.approved || !activeCompany || (!profile.is_admin && !profile.is_platform_owner)) {
      return response({ error: 'Nemate pravo upravljanja korisnicima ili tvrtkama.' }, 403);
    }
    const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return response({ error: 'Zahtjev nije valjan JSON.' }, 400);
    }
    if (!body || typeof body !== 'object') return response({ error: 'Zahtjev nije valjan.' }, 400);

    if (body.action === 'set_active') {
      if (!profile.is_platform_owner) return response({ error: 'Samo vlasnik sustava može mijenjati status tvrtke.' }, 403);
      if (typeof body.aktivna !== 'boolean') return response({ error: 'Status tvrtke nije valjan.' }, 400);
      if (body.company_id === profile.company_id && body.aktivna === false) {
        return response({ error: 'Ne možete deaktivirati tvrtku računa vlasnika sustava.' }, 409);
      }
      const { data, error } = await service.from('tvrtke').update({ aktivna: body.aktivna })
        .eq('id', text(body.company_id)).select('id').single();
      if (error) throw error;
      return response({ company_id: data.id });
    }

    if (body.action !== 'create_company' && body.action !== 'invite') {
      return response({ error: 'Nepoznata radnja.' }, 400);
    }
    const email = text(body.action === 'create_company' ? body.admin_email : body.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: 'Unesite valjanu e-mail adresu.' }, 400);
    if (body.action === 'create_company' && !profile.is_platform_owner) {
      return response({ error: 'Samo vlasnik sustava može otvarati tvrtke.' }, 403);
    }
    let companyId = text(body.company_id);
    const isAdmin = body.action === 'create_company' || body.is_admin === true;
    if (!profile.is_platform_owner && (companyId !== profile.company_id || isAdmin)) {
      return response({ error: 'Možete pozivati djelatnike samo u vlastitu tvrtku.' }, 403);
    }

    // One account belongs to exactly one company. Never move an existing user via an invitation.
    const { data: existing, error: existingError } = await service.from('app_profiles')
      .select('id').ilike('email', email.replace(/[%_\\]/g, '\\$&')).limit(1);
    if (existingError) throw existingError;
    if (existing?.length) return response({ error: 'Za ovu adresu račun već postoji. Pozivnica ne može promijeniti njegovu tvrtku.' }, 409);

    if (body.action === 'create_company') {
      const naziv = text(body.naziv);
      const oib = text(body.oib);
      const adresa = text(body.adresa);
      if (!naziv || !adresa || !/^\d{11}$/.test(oib)) {
        return response({ error: 'Unesite naziv, adresu i OIB od 11 znamenki.' }, 400);
      }
      const { data: created, error } = await service.from('tvrtke')
        .insert({ naziv, oib, adresa }).select('id').single();
      if (error) throw error;
      companyId = created.id;
    }
    const { data: company, error: targetError } = await service.from('tvrtke')
      .select('id,aktivna').eq('id', companyId).single();
    if (targetError) throw targetError;
    if (!company.aktivna) return response({ error: 'Pozivanje u neaktivnu tvrtku nije dopušteno.' }, 409);

    const { error: expiredError } = await service.from('company_invitations').delete()
      .eq('email', email).is('accepted_at', null).lt('expires_at', new Date().toISOString());
    if (expiredError) throw expiredError;
    const { data: invitation, error: inviteError } = await service.from('company_invitations')
      .insert({ company_id: companyId, email, is_admin: isAdmin, created_by: auth.user.id })
      .select('id').single();
    if (inviteError) {
      return response({
        error: `Pozivnica nije pripremljena: ${inviteError.message}${body.action === 'create_company' ? ' Tvrtka je otvorena; ponovite poziv iz njezine kartice.' : ''}`,
        company_id: companyId,
      }, 409);
    }
    const redirectTo = Deno.env.get('APP_URL');
    if (!redirectTo) {
      const { error } = await service.from('company_invitations').delete().eq('id', invitation.id).is('accepted_at', null);
      if (error) throw error;
      return response({ error: 'Nedostaje APP_URL u Supabase Secrets. Tvrtka ostaje spremljena; pozivnicu pošaljite nakon konfiguracije.', company_id: companyId }, 503);
    }
    const { error: deliveryError } = await service.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { gradtech_set_password: true },
    });
    if (deliveryError) {
      const { error: cleanupError } = await service.from('company_invitations').delete()
        .eq('id', invitation.id).is('accepted_at', null);
      if (cleanupError) throw cleanupError;
      return response({
        error: `Slanje pozivnice nije uspjelo: ${deliveryError.message}. Provjerite korisnike i postavke e-pošte u Supabaseu prije ponovnog slanja.`,
        company_id: companyId,
      }, 502);
    }
    return response({ company_id: companyId, invited: true });
  } catch (error) {
    console.error('manage-companies:', error);
    return response({ error: error instanceof Error ? error.message : 'Upravljanje tvrtkom nije uspjelo.' }, 500);
  }
});
