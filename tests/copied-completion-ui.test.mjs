import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

const source = readFileSync(new URL('../src/components/views/NalogIzvrsenje.tsx', import.meta.url), 'utf8');
const stateNames = [...source.slice(source.indexOf('export function NalogIzvrsenje')).matchAll(
  /const \[(\w+),[^\]]+\] = useState/g,
)].map(match => match[1]);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...elements(node.props.children)];
}

function loadView({ status = 'otvoren', failure } = {}) {
  const tasks = ['zadatak', 'dodatni'].map(vrsta => ({ id: vrsta, naziv: vrsta, vrsta, gotovo: true, gotovo_at: '2026-11-20T10:00:00Z' }));
  const items = ['materijal', 'alat'].map(tip => ({ id: tip, naziv: tip, tip, gotovo: true, uzeto: true }));
  const refreshedTasks = tasks.map(task => ({ ...task, gotovo: false, gotovo_at: null }));
  const refreshedItems = items.map(item => ({ ...item, gotovo: false, uzeto: false }));
  const states = { zadaci: tasks, stavke: items };
  const calls = [];
  let cursor = 0;
  let childMode = false;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const save = async (...args) => {
    calls.push(['update', ...args]);
    await pending;
    if (failure) throw failure;
  };
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Date,
    require(name) {
      if (name === 'react') return {
        useState(initial) {
          if (childMode) return [true, () => {}];
          const key = stateNames[cursor++];
          assert.ok(key, 'Every component state must be accounted for');
          if (!(key in states)) states[key] = initial;
          return [states[key], next => { states[key] = typeof next === 'function' ? next(states[key]) : next; }];
        },
        useCallback: callback => callback, useEffect() {}, useRef: () => ({ current: null }),
      };
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'react-dom') return { createPortal: node => node };
      if (name === 'lucide-react') return Object.fromEntries(
        'Camera Check ChevronLeft ChevronRight Clock FileText Gauge Hammer Package Plus Trash2 X ListChecks Wrench'
          .split(' ').map(icon => [icon, () => null]),
      );
      if (name === '@/auth/useAuth') return { useAuth: () => ({ canAccess: () => true }) };
      if (name === '@/types') return { zadatakVrsta: task => task.vrsta ?? 'zadatak' };
      if (name === '@/lib/localization') return { formatHrDateTime: () => '20.11.2026. 10:00' };
      if (name === '@/components/views/WorkOrderItemChangeHistory') return { WorkOrderItemChangeHistory: () => null };
      if (name === '@/components/views/HistoryDialog') return { HistoryButton: () => null, HistoryDialog: () => null };
      if (name === '@/lib/useDeferredFiles') return { useDeferredFiles: () => ({ data: [], setData() {} }) };
      if (name === '@/components/ui/PrivateImage') return { PrivateImage: () => null, PrivateFileLink: () => null };
      if (name === '@/lib/useNalogExecution') return {
        useNalogExecution: () => ({
          snapshot: states,
          execution: {
            getSnapshot: () => states,
            field(_snapshot, key) {
              const defaults = {
                km: { pocetak: '', kraj: '' }, vremena: [], zadaci: [], stavke: [], alati: [], strojevi: [],
                napomena: '', poslovodja: null, vozac: null, error: null,
              };
              if (!(key in states)) states[key] = key in defaults ? defaults[key] : false;
              return [states[key], next => { states[key] = typeof next === 'function' ? next(states[key]) : next; }];
            },
            timeSavePending: { current: false }, persistDefaults: async () => {},
          },
        }),
      };
      if (name === '@/lib/api') return {
        updateGradilisteZadatak: save, updateNalogStavka: save,
        fetchNalogZadaci: async id => { calls.push(['tasks', id]); return refreshedTasks; },
        fetchNalogStavke: async id => { calls.push(['items', id]); return refreshedItems; },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => {
    cursor = 0;
    return module.exports.NalogIzvrsenje({ nalog: { id: 'order', gradiliste_id: 'site', status } });
  };
  const historyCheckbox = kind => {
    const history = elements(render()).find(node =>
      node.type.name === (['zadatak', 'dodatni'].includes(kind) ? 'CompletedTaskHistory' : 'ResolvedStavkeHistory')
      && node.props.items.some(item => item.id === kind));
    assert.ok(history, `Completed ${kind} remains visible in history`);
    childMode = true;
    try {
      return elements(history.type(history.props)).find(node => node.type === 'input' && node.props.type === 'checkbox');
    } finally {
      childMode = false;
    }
  };
  return { states, calls, tasks, items, refreshedTasks, refreshedItems, release, historyCheckbox };
}

for (const kind of ['zadatak', 'dodatni', 'materijal', 'alat']) {
  test(`ERP reopens ${kind} from history and reloads all selected-order records after successful saving`, async () => {
    const view = loadView();
    const checkbox = view.historyCheckbox(kind);
    assert.equal(checkbox.props.checked, true);
    assert.equal(checkbox.props.disabled, false);
    checkbox.props.onChange();
    assert.equal(view.states.savingCompletion, true);
    assert.equal(view.historyCheckbox(kind).props.disabled, true);
    assert.deepEqual(view.states.zadaci, view.tasks, 'Do not optimistically hide or reopen tasks');
    assert.deepEqual(view.states.stavke, view.items, 'Do not optimistically hide or reopen items');
    view.release();
    await new Promise(resolve => setImmediate(resolve));
    const tasks = ['zadatak', 'dodatni'].includes(kind);
    assert.deepEqual(JSON.parse(JSON.stringify(view.calls)), [
      ['update', kind, { gotovo: false }],
      [tasks ? 'tasks' : 'items', 'order'],
    ]);
    assert.deepEqual(view.states[tasks ? 'zadaci' : 'stavke'], tasks ? view.refreshedTasks : view.refreshedItems);
    assert.equal(view.states.savingCompletion, false);
  });

  test(`ERP preserves ${kind} status and surfaces failed saving`, async () => {
    const view = loadView({ failure: new Error('Povezani nalog upravo uređuje druga osoba.') });
    view.historyCheckbox(kind).props.onChange();
    view.release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.calls.length, 1, 'Do not pretend failed saving succeeded by reloading');
    assert.deepEqual(view.states.zadaci, view.tasks);
    assert.deepEqual(view.states.stavke, view.items);
    assert.match(view.states.error, /upravo uređuje druga osoba/);
    assert.equal(view.states.savingCompletion, false);
  });
}

test('ERP disables completion and reopening on finished or cancelled orders', () => {
  for (const status of ['zavrsen', 'otkazan']) {
    const view = loadView({ status });
    for (const kind of ['zadatak', 'dodatni', 'materijal', 'alat']) {
      const checkbox = view.historyCheckbox(kind);
      assert.equal(checkbox.props.disabled, true);
      checkbox.props.onChange();
    }
    assert.deepEqual(view.calls, []);
  }
});
