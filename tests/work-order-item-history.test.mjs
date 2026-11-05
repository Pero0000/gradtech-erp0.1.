import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import * as jsxRuntime from 'react/jsx-runtime';

const apiSource = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../supabase/migrations/20261110260000_nalog_stavke_povijest_izmjena.sql',
  import.meta.url,
), 'utf8');

const companyId = '00000000-0000-0000-0000-000000000001';
const userId = '00000000-0000-0000-0000-000000000002';
const orderId = '00000000-0000-0000-0000-000000000003';
const itemId = '00000000-0000-0000-0000-000000000004';
const toolId = '00000000-0000-0000-0000-000000000005';
const machineId = '00000000-0000-0000-0000-000000000006';

function loadApi(rpc) {
  const { outputText } = ts.transpileModule(apiSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name) => {
      if (name === './supabase') return { supabase: { rpc } };
      return {};
    },
  });
  return module.exports;
}

function loadPanel({ allowed = true, entry, restoreError, refreshError } = {}) {
  const source = readFileSync(new URL('../src/components/views/WorkOrderItemChangeHistory.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const calls = [];
  const states = [];
  let stateIndex = 0;
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Date, window: { confirm: () => true },
    require: (name) => {
      if (name === 'react') return {
        useState: (initial) => {
          const index = stateIndex++;
          const value = states[index] ?? (index === 0 ? true : index === 1 ? [entry].filter(Boolean) : initial);
          states[index] = value;
          return [value, (next) => {
            states[index] = typeof next === 'function' ? next(states[index]) : next;
          }];
        },
        useEffect() {}, useCallback: (callback) => callback,
      };
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'lucide-react') return { RotateCcw() {} };
      if (name === './HistoryDialog') return {
        HistoryButton: (props) => jsxRuntime.jsx('button', { ...props, children: 'Povijest' }),
        HistoryDialog: ({ open, title, children }) => open
          ? jsxRuntime.jsxs('div', { children: [title, children] })
          : null,
      };
      if (name === '@/auth/useAuth') return { useAuth: () => ({ canAccess: () => allowed }) };
      if (name === '@/lib/localization') return { formatHrDateTime: () => '05.11.2026. 09:00:00' };
      if (name === '@/lib/useRequestScope') return {
        useRequestScope: () => ({ start: () => () => true, invalidate() {} }),
      };
      if (name === '@/lib/api') return {
        fetchWorkOrderItemChangeHistory: async (...args) => { calls.push(['fetch', ...args]); return []; },
        restoreWorkOrderItemChange: async (...args) => {
          calls.push(['restore', ...args]);
          if (restoreError) throw restoreError;
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  stateIndex = 0;
  const component = module.exports.WorkOrderItemChangeHistory;
  const tree = component({ nalogId: orderId, onRestore: async () => {
    calls.push(['refresh']);
    if (refreshError) throw refreshError;
  } });
  return { tree, calls, states };
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...elements(node.props.children)];
}

test('work-order item history panel gates access, confirms restore, refreshes rows, and surfaces refresh errors', async () => {
  assert.equal(loadPanel({ allowed: false }).tree, null);
  const entry = {
    id: 'history-id', sequence: '1', item_id: itemId,
    before_data: { tip: 'materijal', naziv: 'Boja', gotovo: false, uzeto: false },
    after_data: { tip: 'materijal', naziv: 'Boja', gotovo: true, uzeto: true },
    actor_name: 'Ured', created_at: '2026-11-05T08:00:00Z',
    expires_at: '2026-12-05T08:00:00Z', reversed_at: null, reverses_id: null,
    can_restore: true, blocked_reason: null,
  };
  const panel = loadPanel({ entry });
  const restore = elements(panel.tree).find((element) => element.type === 'button'
    && element.props.children?.[1] === ' Vrati promjenu');
  assert.ok(restore);
  await restore.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(panel.calls)), [
    ['restore', 'history-id'], ['fetch', orderId, null], ['refresh'],
  ]);

  const refreshFailure = loadPanel({ entry, refreshError: new Error('Nije učitano') });
  const failedRestore = elements(refreshFailure.tree).find((element) => element.type === 'button'
    && element.props.children?.[1] === ' Vrati promjenu');
  await failedRestore.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(refreshFailure.states.some((value) => value === 'Promjena je vraćena, ali stavke nisu osvježene: Nije učitano'));
});

test('work-order item history API uses RPC pagination, server-only restore data, and explicit migration errors', async () => {
  const calls = [];
  const api = loadApi(async (...args) => {
    calls.push(args);
    return { data: [], error: null };
  });
  await api.fetchWorkOrderItemChangeHistory(orderId);
  await api.fetchWorkOrderItemChangeHistory(orderId, '9007199254740993');
  await api.restoreWorkOrderItemChange('history-id');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_work_order_item_change_history', { p_nalog_id: orderId, p_before_sequence: null }],
    ['get_work_order_item_change_history', { p_nalog_id: orderId, p_before_sequence: '9007199254740993' }],
    ['restore_work_order_item_change', { p_history_id: 'history-id' }],
  ]);
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const missing = loadApi(async () => ({ error: { code } }));
    await assert.rejects(missing.fetchWorkOrderItemChangeHistory(orderId), /20261110260000/);
    await assert.rejects(missing.restoreWorkOrderItemChange('history-id'), /20261110260000/);
  }
  const error = { code: '42501', message: 'Denied' };
  const denied = loadApi(async () => ({ error }));
  await assert.rejects(denied.fetchWorkOrderItemChangeHistory(orderId), (reason) => reason === error);
  await assert.rejects(denied.restoreWorkOrderItemChange('history-id'), (reason) => reason === error);
});

test('work-order material and tool changes restore latest-first and reject stale, unsupported, or closed-order restores', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE SCHEMA private;
    CREATE SCHEMA cron;
    CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    CREATE TABLE public.tvrtke (id uuid PRIMARY KEY, aktivna boolean NOT NULL);
    CREATE TABLE public.app_profiles (id uuid PRIMARY KEY, email text, company_id uuid, approved boolean);
    CREATE TABLE public.app_user_permissions (user_id uuid, module text, can_edit boolean);
    CREATE FUNCTION public.app_current_company_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT profile.company_id FROM public.app_profiles profile
        JOIN public.tvrtke company ON company.id = profile.company_id
        WHERE profile.id = auth.uid() AND profile.approved AND company.aktivna;
      $$;
    CREATE FUNCTION public.app_has_module_permission(p_module text, p_action text) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.app_profiles profile
          JOIN public.app_user_permissions permission ON permission.user_id = profile.id
          WHERE profile.id = auth.uid() AND profile.approved
            AND profile.company_id = public.app_current_company_id()
            AND permission.module = p_module AND permission.can_edit
        );
      $$;
    CREATE TABLE public.radni_nalozi (
      id uuid PRIMARY KEY, company_id uuid NOT NULL, status text NOT NULL
    );
    CREATE TABLE public.radni_nalozi_stavke (
      id uuid PRIMARY KEY, company_id uuid NOT NULL, nalog_id uuid, gradiliste_id uuid,
      tip text NOT NULL, naziv text NOT NULL, gotovo boolean NOT NULL DEFAULT false,
      uzeto boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
      oprema_id uuid, sati numeric, preneseno boolean NOT NULL DEFAULT false,
      izvor_id uuid, cijena_sata numeric, koristenje_at timestamptz
    );
    CREATE FUNCTION public.sync_material_tool_completion()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.tip IN ('materijal','alat') THEN
        IF NEW.gotovo IS NOT DISTINCT FROM OLD.gotovo AND NEW.uzeto IS DISTINCT FROM OLD.uzeto THEN
          NEW.gotovo := COALESCE(NEW.uzeto,false);
        END IF;
        NEW.uzeto := NEW.gotovo;
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER sync_material_tool_completion
      BEFORE UPDATE OF gotovo,uzeto ON public.radni_nalozi_stavke
      FOR EACH ROW EXECUTE FUNCTION public.sync_material_tool_completion();
    GRANT SELECT,UPDATE ON public.radni_nalozi,public.radni_nalozi_stavke TO authenticated;
    INSERT INTO public.tvrtke VALUES ('${companyId}',true);
    INSERT INTO public.app_profiles VALUES ('${userId}','editor@example.test','${companyId}',true);
    INSERT INTO public.app_user_permissions VALUES ('${userId}','radni_nalozi',true);
    INSERT INTO public.radni_nalozi VALUES ('${orderId}','${companyId}','u_tijeku');
    INSERT INTO public.radni_nalozi_stavke(id,company_id,nalog_id,tip,naziv)
      VALUES ('${itemId}','${companyId}','${orderId}','materijal','Boja'),
        ('${toolId}','${companyId}','${orderId}','alat','Skela'),
        ('${machineId}','${companyId}','${orderId}','stroj','Dizalica');
    SELECT set_config('request.jwt.claim.sub','${userId}',false);
  `);
  await db.exec(migration);
  await db.exec('SET ROLE authenticated');
  await db.query("UPDATE public.radni_nalozi_stavke SET gotovo=true,uzeto=true WHERE id=$1", [itemId]);
  let history = (await db.query('SELECT * FROM public.get_work_order_item_change_history($1)', [orderId])).rows;
  assert.equal(history.length, 1);
  assert.equal(history[0].can_restore, true);
  await db.query('SELECT public.restore_work_order_item_change($1)', [history[0].id]);
  let item = (await db.query('SELECT * FROM public.radni_nalozi_stavke WHERE id=$1', [itemId])).rows[0];
  assert.equal(item.gotovo, false);
  assert.equal(item.uzeto, false);

  await db.query("UPDATE public.radni_nalozi_stavke SET naziv='Boja nova' WHERE id=$1", [itemId]);
  await db.query('UPDATE public.radni_nalozi_stavke SET gotovo=true WHERE id=$1', [itemId]);
  history = (await db.query('SELECT * FROM public.get_work_order_item_change_history($1)', [orderId])).rows;
  const olderName = history.find((entry) => entry.before_data.naziv === 'Boja' && entry.after_data.naziv === 'Boja nova');
  const newerCheck = history.find((entry) => entry.after_data.gotovo === true && entry.before_data.naziv === 'Boja nova');
  assert.equal(olderName.can_restore, false);
  await db.query('SELECT public.restore_work_order_item_change($1)', [newerCheck.id]);
  history = (await db.query('SELECT * FROM public.get_work_order_item_change_history($1)', [orderId])).rows;
  assert.equal(history.find((entry) => entry.id === olderName.id).can_restore, true);
  await db.query('SELECT public.restore_work_order_item_change($1)', [olderName.id]);
  item = (await db.query('SELECT * FROM public.radni_nalozi_stavke WHERE id=$1', [itemId])).rows[0];
  assert.equal(item.naziv, 'Boja');
  assert.equal(item.gotovo, false);

  await db.query("UPDATE public.radni_nalozi_stavke SET sati=4 WHERE id=$1", [machineId]);
  history = (await db.query('SELECT * FROM public.get_work_order_item_change_history($1)', [orderId])).rows;
  const machineChange = history.find((entry) => entry.item_id === machineId);
  assert.equal(machineChange.can_restore, false);
  assert.match(machineChange.blocked_reason, /izvan podržane obnove/);
  await assert.rejects(db.query('SELECT public.restore_work_order_item_change($1)', [machineChange.id]), (error) => error.code === '40001');

  await db.query("UPDATE public.radni_nalozi SET status='zavrsen' WHERE id=$1", [orderId]);
  await db.query('UPDATE public.radni_nalozi_stavke SET gotovo=true WHERE id=$1', [toolId]);
  history = (await db.query('SELECT * FROM public.get_work_order_item_change_history($1)', [orderId])).rows;
  const closedOrderChange = history.find((entry) => entry.item_id === toolId);
  assert.equal(closedOrderChange.can_restore, false);
  assert.match(closedOrderChange.blocked_reason, /zaključenog/);
  await assert.rejects(db.query('SELECT public.restore_work_order_item_change($1)', [closedOrderChange.id]), (error) => error.code === '40001');
  await db.exec('RESET ROLE');
});
