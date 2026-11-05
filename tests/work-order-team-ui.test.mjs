import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

const source = readFileSync(new URL('../src/components/views/FuelChangeHistory.tsx', import.meta.url), 'utf8');

function loadPanel({ allowed = true, entry, restoreFailure, refreshFailure } = {}) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const calls = [];
  const states = [];
  let stateIndex = 0;
  const confirmMessages = [];
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Date,
    window: { confirm: (message) => { confirmMessages.push(message); return true; } },
    require: (name) => {
      if (name === 'react') return {
        useState(initial) {
          const index = stateIndex++;
          const value = index === 0 ? true : index === 1 ? [entry].filter(Boolean) : initial;
          states[index] = value;
          return [value, (next) => {
            states[index] = typeof next === 'function' ? next(states[index]) : next;
          }];
        },
        useEffect() {},
        useCallback: (callback) => callback,
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
      if (name === '@/lib/localization') return {
        formatHrDateTime: () => '05.11.2026. 09:00:00',
        formatHrDate: () => '05.11.2026.',
      };
      if (name === '@/lib/useRequestScope') return {
        useRequestScope: () => ({ start: () => () => true, invalidate() {} }),
      };
      if (name === '@/lib/resourceHistory') return {
        resourceHistoryDifferences: () => [],
        taskDeadlineHistoryLines: () => [],
      };
      if (name === '@/lib/api') return {
        fetchWorkOrderTeamChangeHistory: async (...args) => { calls.push(['fetch', ...args]); return []; },
        restoreWorkOrderTeamChange: async (...args) => {
          calls.push(['restore', ...args]);
          if (restoreFailure) throw restoreFailure;
        },
      };
      if (name === '@/auth/permissions') return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const { OrderTeamChangeHistoryPanel, FuelChangeHistory } = module.exports;
  const panel = OrderTeamChangeHistoryPanel({
    recordId: 'order-id',
    onRestore: async () => {
      calls.push(['refresh']);
      if (refreshFailure) throw refreshFailure;
    },
  });
  if (!panel) return { panel, calls, states, confirmMessages };
  stateIndex = 0;
  const tree = FuelChangeHistory(panel.props);
  return { panel, tree, calls, states, confirmMessages };
}

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...elements(node.props.children)];
}

test('work-order team history panel gates access and explains its limited restore scope', async () => {
  const blocked = loadPanel({ allowed: false });
  assert.equal(blocked.panel, null);

  const entry = {
    id: 'history-id', sequence: '20', operation: 'DELETE',
    before_data: { radnik_id: 'worker-id' }, after_data: null,
    actor_name: 'Ured', created_at: '2026-11-05T08:00:00Z',
    expires_at: '2026-12-05T08:00:00Z', reversed_at: null,
    reverses_id: null, can_restore: true, blocked_reason: null,
  };
  const rendered = loadPanel({ entry });
  const text = elements(rendered.tree).map((element) => element.props.children)
    .flat(Infinity).filter((value) => typeof value === 'string').join(' ');
  assert.ok(elements(rendered.tree).some((element) => element.props.title === 'Povijest promjena i vraćanje (30 dana)'));
  assert.match(text, /Vraća se pojedinačno dodavanje ili uklanjanje djelatnika/);
  assert.match(text, /rasporedi, poslovođa, vozač i ostali podaci naloga ne mijenjaju se/);

  const restore = elements(rendered.tree).find((element) => element.type === 'button'
    && element.props.children?.includes('Vrati promjenu'));
  assert.ok(restore);
  await restore.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(rendered.confirmMessages[0], /Vratiti uklonjenu dodjelu djelatnika/);
  assert.match(rendered.confirmMessages[0], /bez evidentiranih sati/);
  assert.deepEqual(JSON.parse(JSON.stringify(rendered.calls)), [
    ['restore', 'history-id'], ['fetch', 'order-id', null], ['refresh'],
  ]);
});

test('work-order team history reports a refresh failure separately after a successful restore', async () => {
  const entry = {
    id: 'history-id', sequence: '21', operation: 'INSERT',
    before_data: null, after_data: { radnik_id: 'worker-id' },
    actor_name: 'Ured', created_at: '2026-11-05T08:00:00Z',
    expires_at: '2026-12-05T08:00:00Z', reversed_at: null,
    reverses_id: null, can_restore: true, blocked_reason: null,
  };
  const rendered = loadPanel({ entry, refreshFailure: new Error('Osvježavanje nije uspjelo') });
  const restore = elements(rendered.tree).find((element) => element.type === 'button'
    && element.props.children?.includes('Vrati promjenu'));
  await restore.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(rendered.states.includes('Promjena je vraćena, ali prikaz nije osvježen: Osvježavanje nije uspjelo'));
});
