import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadTypeScript(relativePath, mocks = {}, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    },
    ...globals,
  });
  return module.exports;
}

const pagination = loadTypeScript('../src/lib/pagination.ts');

test('pagination returns all workers beyond the default 1000-row limit', async () => {
  const records = Array.from({ length: 1301 }, (_, id) => ({ id }));
  const calls = [];
  const rows = await pagination.fetchAllRows((from, to) => {
    calls.push([from, to]);
    return Promise.resolve({ data: records.slice(from, to + 1), error: null });
  });
  assert.equal(rows.length, 1301);
  assert.equal(rows[1300].id, 1300);
  assert.deepEqual(calls, [[0, 499], [500, 999], [1000, 1499]]);
});

test('pagination propagates database errors instead of returning a partial list', async () => {
  const error = { message: 'database unavailable' };
  await assert.rejects(pagination.fetchAllRows(() => Promise.resolve({ data: null, error })),
    (reason) => reason === error);
});

test('company storage isolates settings and migrates legacy settings only to the initial company', () => {
  const values = new Map([['tm_ponude_postavke', '{"izvodac":"Tm-color"}']]);
  const company = loadTypeScript('../src/lib/company.ts', {
    './supabase': { supabase: {} }, './pagination': pagination,
  }, { localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  } });
  const initial = { id: 'initial', oib: '29191529726' };
  const second = { id: 'second', oib: '00000000002' };
  company.setCurrentCompany(second);
  assert.equal(company.companyStorage.getItem('tm_ponude_postavke'), null);
  company.companyStorage.setItem('tm_ponude_postavke', 'second settings');
  company.setCurrentCompany(initial);
  assert.equal(company.companyStorage.getItem('tm_ponude_postavke'), '{"izvodac":"Tm-color"}');
  company.companyStorage.removeItem('tm_ponude_postavke');
  company.setCurrentCompany(initial);
  assert.equal(company.companyStorage.getItem('tm_ponude_postavke'), null, 'legacy migration runs only once');
  company.setCurrentCompany(second);
  assert.equal(company.companyStorage.getItem('tm_ponude_postavke'), 'second settings');
  company.setCurrentCompany(null);
  assert.throws(() => company.requireCompany(), /Tvrtka korisnika nije učitana/);
});

function provisioning({ owner = false, admin = true, approved = true, active = true, existing = false, appUrl = true } = {}) {
  let handler;
  const writes = [];
  const invitations = [];
  const profile = { id: 'user-a', company_id: 'company-a', approved, is_admin: admin, is_platform_owner: owner };
  const caller = {
    auth: { getUser: async () => ({ data: { user: { id: profile.id } }, error: null }) },
    rpc: async () => ({ data: active ? profile.company_id : null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: profile, error: null }) }) }) }),
  };
  function query(table) {
    let operation = 'select';
    let payload;
    const q = {
      select: () => q, eq: () => q, is: () => q, lt: () => q, ilike: () => q,
      insert: (value) => { operation = 'insert'; payload = value; writes.push({ table, value }); return q; },
      delete: () => { operation = 'delete'; return q; },
      update: (value) => { operation = 'update'; payload = value; writes.push({ table, value }); return q; },
      single: async () => ({
        data: table === 'tvrtke' ? { id: operation === 'insert' ? 'company-new' : 'company-a', aktivna: true, ...payload } : { id: 'invitation-id' },
        error: null,
      }),
      limit: async () => ({ data: existing ? [{ id: 'existing-user' }] : [], error: null }),
      then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject),
    };
    return q;
  }
  const service = {
    from: query,
    auth: { admin: { inviteUserByEmail: async (email, options) => {
      invitations.push({ email, options });
      return { error: null };
    } } },
  };
  let calls = 0;
  loadTypeScript('../supabase/functions/manage-companies/index.ts', {
    'https://esm.sh/@supabase/supabase-js@2': { createClient: () => ++calls === 1 ? caller : service },
  }, {
    Response, Request, console,
    Deno: {
      serve: (callback) => { handler = callback; },
      env: { get: (key) => key === 'APP_URL' ? (appUrl ? 'https://erp.example.test' : undefined) : 'test-config' },
    },
  });
  return {
    writes, invitations,
    send: (body) => handler(new Request('https://functions.example.test', {
      method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })),
  };
}

for (const body of [
  { action: 'create_company', admin_email: 'new@example.test' },
  { action: 'set_active', company_id: 'company-b', aktivna: false },
  { action: 'invite', company_id: 'company-b', email: 'new@example.test' },
  { action: 'invite', company_id: 'company-a', email: 'new@example.test', is_admin: true },
]) {
  test(`company admin cannot perform foreign/owner action: ${JSON.stringify(body)}`, async () => {
    const app = provisioning();
    assert.equal((await app.send(body)).status, 403);
    assert.equal(app.writes.length, 0);
    assert.equal(app.invitations.length, 0);
  });
}

test('disabled companies cannot send invitations', async () => {
  const app = provisioning({ active: false });
  assert.equal((await app.send({ action: 'invite', company_id: 'company-a', email: 'new@example.test' })).status, 403);
  assert.equal(app.writes.length, 0);
});

test('ordinary users cannot use the management endpoint', async () => {
  const app = provisioning({ admin: false });
  assert.equal((await app.send({ action: 'invite', company_id: 'company-a', email: 'new@example.test' })).status, 403);
});

test('own-company invitation records membership server-side and uses configured redirect', async () => {
  const app = provisioning();
  assert.equal((await app.send({ action: 'invite', company_id: 'company-a', email: 'New@Example.Test' })).status, 200);
  const invitation = app.writes.find((write) => write.table === 'company_invitations').value;
  assert.equal(invitation.company_id, 'company-a');
  assert.equal(invitation.is_admin, false);
  assert.equal(invitation.email, 'new@example.test');
  assert.equal(app.invitations[0].options.redirectTo, 'https://erp.example.test');
  assert.equal(app.invitations[0].options.data.gradtech_set_password, true);
});

test('existing accounts are never reassigned through an invitation', async () => {
  const app = provisioning({ owner: true, existing: true });
  assert.equal((await app.send({ action: 'invite', company_id: 'company-b', email: 'existing@example.test', is_admin: true })).status, 409);
  assert.equal(app.writes.length, 0);
});

test('owner creates a company and invites its first admin without modifying other profiles', async () => {
  const app = provisioning({ owner: true });
  assert.equal((await app.send({
    action: 'create_company', naziv: 'New company', oib: '12345678901', adresa: 'Test address', admin_email: 'admin@example.test',
  })).status, 200);
  const invitation = app.writes.find((write) => write.table === 'company_invitations').value;
  assert.equal(invitation.company_id, 'company-new');
  assert.equal(invitation.is_admin, true);
  assert.ok(app.writes.every((write) => write.table !== 'app_profiles'));
});

test('missing invitation redirect configuration is an explicit failure', async () => {
  const app = provisioning({ appUrl: false });
  const result = await app.send({ action: 'invite', company_id: 'company-a', email: 'new@example.test' });
  assert.equal(result.status, 503);
  assert.match((await result.json()).error, /APP_URL/);
  assert.equal(app.invitations.length, 0);
});
