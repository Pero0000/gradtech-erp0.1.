import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function hooks() {
  const slots = [];
  let index = 0;
  let pending = [];
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  return {
    react: {
      useState(initial) {
        const i = index++;
        if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
        return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
      },
      useRef(initial) {
        const i = index++;
        if (!(i in slots)) slots[i] = { current: initial };
        return slots[i];
      },
      useMemo(factory, deps) {
        const i = index++;
        if (!sameDeps(slots[i]?.deps, deps)) slots[i] = { deps, value: factory() };
        return slots[i].value;
      },
      useCallback(fn, deps) { return this.useMemo(() => fn, deps); },
      useEffect(effect, deps) {
        const i = index++;
        if (!sameDeps(slots[i]?.deps, deps)) {
          slots[i]?.cleanup?.();
          slots[i] = { deps };
          pending.push(() => { slots[i].cleanup = effect(); });
        }
      },
    },
    render(fn) {
      index = 0;
      const result = fn();
      const effects = pending;
      pending = [];
      effects.forEach((effect) => effect());
      return result;
    },
    dispose() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

function setup() {
  const runtime = hooks();
  // Hook exports are invoked as standalone functions by the transpiled module.
  runtime.react.useCallback = runtime.react.useCallback.bind(runtime.react);
  const database = {
    app_profiles: { id: 'user', email: 'test@example.test', approved: true, is_admin: false,
      radnik_id: null, company_id: 'company', is_platform_owner: false, is_voditelj: true },
    tvrtke: { id: 'company', naziv: 'Tvrtka', oib: '123', adresa: 'Adresa', aktivna: true,
      postavke: { disabled_modules: [], invoice_rebate_mode: 'pribroji', extra: { a: 1, b: 2 } } },
    app_user_permissions: ['gradilista', 'radnici', 'vozila', 'raspored', 'troskovi', 'radni_nalozi', 'obavijesti']
      .map((module) => ({ module, can_view: true, can_edit: true })),
  };
  const queries = [];
  const companyWrites = [];
  const timers = new Map();
  const listeners = new Map();
  let authListener;
  let failure = null;
  const session = { user: { id: 'user', user_metadata: {} } };
  const module = { exports: {} };
  const mocks = {
    react: runtime.react, 'react/jsx-runtime': jsxRuntime,
    '@/auth/context': { AuthContext: { Provider: 'provider' } },
    '@/lib/company': {
      normalizeTvrtkaPostavke: (settings) => settings,
      setCurrentCompany: (company) => companyWrites.push(company),
    },
    '@/lib/supabase': { supabase: {
      auth: {
        getSession: async () => ({ data: { session }, error: null }),
        onAuthStateChange: (listener) => {
          authListener = listener;
          return { data: { listener: null, subscription: { unsubscribe() {} } } };
        },
        signOut: async () => { authListener('SIGNED_OUT', null); return { error: null }; },
      },
      from(table) {
        queries.push(table);
        const result = () => ({ data: structuredClone(database[table]), error: failure });
        const query = {
          select: () => query, eq: () => query,
          single: async () => result(), maybeSingle: async () => result(),
          then: (resolve) => Promise.resolve(result()).then(resolve),
        };
        return query;
      },
    } },
  };
  vm.runInNewContext(compile(read('../src/auth/AuthContext.tsx')), {
    module, exports: module.exports, Error,
    require: (name) => { assert.ok(name in mocks, name); return mocks[name]; },
    window: { setInterval: (fn, delay) => { timers.set(delay, fn); return delay; }, clearInterval: (id) => timers.delete(id) },
    document: {
      visibilityState: 'visible',
      addEventListener: (event, fn) => listeners.set(event, fn),
      removeEventListener: (event) => listeners.delete(event),
    },
  });
  const render = () => runtime.render(() => module.exports.AuthProvider({ children: null })).props.value;
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const ready = async () => {
    render(); await settle(); render(); await settle(); return render();
  };

  // Execute the actual global data effects, rather than a proxy for their dependencies.
  const app = ts.createSourceFile('App.tsx', read('../src/App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const effects = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(app) === 'useEffect'
      && /loadObavijesti|fetchGradilista/.test(node.getText(app))) effects.push(node.getText(app));
    ts.forEachChild(node, visit);
  }
  visit(app);
  assert.equal(effects.length, 2);
  const consumer = hooks();
  const dataCalls = [];
  const scope = {
    useEffect: consumer.react.useEffect, setCounts() {}, loadPostavke: () => ({}), sendPushNotifications() {},
    window: { addEventListener() {}, removeEventListener() {}, setInterval() {}, clearInterval() {} },
  };
  for (const name of ['loadObavijesti', 'fetchGradilista', 'fetchRadnici', 'fetchVozila',
    'fetchRasporedi', 'fetchTroskovi', 'fetchRadniNalozi']) {
    scope[name] = async () => { dataCalls.push(name); return []; };
  }
  const dataEffects = vm.runInNewContext(compile(`(auth) => {
    const {profile, canAccess} = auth; const view = 'dashboard';
    ${effects.join(';\n')}
  }`), scope);
  return {
    database, queries, companyWrites, timers, dataCalls, ready, render, settle,
    renderApp: (auth) => consumer.render(() => dataEffects(auth)),
    fail: () => { failure = new Error('Provjera ovlasti nije uspjela'); },
    dispose: () => { runtime.dispose(); consumer.dispose(); },
  };
}

test('60-second access checks preserve references and do not reload any global application data', async (t) => {
  const s = setup();
  t.after(s.dispose);
  const initial = await s.ready();
  s.renderApp(initial);
  await s.settle();
  const initialCalls = [...s.dataCalls];
  assert.equal(initialCalls.length, 7);
  for (let minute = 0; minute < 3; minute++) {
    s.database.app_user_permissions.reverse();
    s.database.tvrtke.postavke.extra = { b: 2, a: 1 };
    s.timers.get(60_000)();
    s.renderApp(s.render()); // also check the loading-state render
    await s.settle();
    const refreshed = s.render();
    assert.equal(refreshed.company, initial.company);
    assert.equal(refreshed.permissions, initial.permissions);
    assert.equal(refreshed.profile, initial.profile);
    assert.equal(refreshed.canAccess, initial.canAccess);
    s.renderApp(refreshed);
    await s.settle();
    assert.deepEqual(s.dataCalls, initialCalls);
  }
  assert.equal(s.companyWrites.length, 1, 'imperative company context also keeps the same object');
  assert.equal(s.queries.filter((table) => table === 'app_profiles').length, 4, 'access checks still run');
});

test('real permission, company-setting and role changes still take effect; failures and sign-out revoke access', async (t) => {
  const s = setup();
  t.after(s.dispose);
  let auth = await s.ready();
  const original = auth;
  s.database.app_user_permissions.find((row) => row.module === 'vozila').can_edit = false;
  await auth.refreshAccess();
  auth = s.render();
  assert.notEqual(auth.permissions, original.permissions);
  assert.notEqual(auth.canAccess, original.canAccess);
  assert.equal(auth.company, original.company);
  assert.equal(auth.canAccess('vozila', 'edit'), false);
  assert.equal(auth.canAccess('vozila'), true);

  s.database.tvrtke.postavke.disabled_modules = ['gradilista'];
  await auth.refreshAccess();
  auth = s.render();
  assert.equal(auth.canAccess('gradilista'), false);
  assert.notEqual(auth.company, original.company);
  assert.equal(s.companyWrites.at(-1), auth.company);

  s.database.app_profiles.is_admin = true;
  await auth.refreshAccess();
  auth = s.render();
  assert.equal(auth.isAdmin, true);
  assert.equal(auth.canAccess('dashboard'), true);
  assert.equal(auth.canAccess('gradilista'), false, 'disabled modules also apply to admins');
  s.fail();
  await auth.refreshAccess();
  auth = s.render();
  assert.equal(auth.company, null);
  assert.equal(auth.profile, null);
  assert.equal(auth.canAccess('dashboard'), false);
  assert.match(auth.accessError, /Provjera ovlasti/);
  await auth.signOut();
  auth = s.render();
  assert.equal(auth.canAccess('vozila'), false);
  assert.equal(auth.company, null);
});
