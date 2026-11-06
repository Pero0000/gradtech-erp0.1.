import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

const source = readFileSync(new URL('../src/components/views/FuelCategorySettings.tsx', import.meta.url), 'utf8');
const stateNames = [...source.matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map(match => match[1]);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
});
const categories = [
  { naziv: 'Radnik', dozvoljeni_tipovi_vozila: ['Teretno'] },
  { naziv: 'Poslovođa', dozvoljeni_tipovi_vozila: null },
];

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...elements(node.props.children)];
}

function setup({ canView = true, canEdit = true, loadError, saveError } = {}) {
  const states = {};
  const calls = [];
  let cursor = 0;
  let effect;
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Error,
    require(name) {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'react') return {
        useState(initial) {
          const key = stateNames[cursor++];
          if (!(key in states)) states[key] = initial;
          return [states[key], next => { states[key] = typeof next === 'function' ? next(states[key]) : next; }];
        },
        useEffect(callback) { effect = callback; },
      };
      if (name === 'lucide-react') return { ChevronDown() {}, Save() {} };
      if (name === '@/components/ui/Field') return { Select() {} };
      if (name === '@/auth/useAuth') return {
        useAuth: () => ({ canAccess: (module, action) => {
          assert.equal(module, 'radnici', 'Keep the existing worker-category permissions');
          return action === 'edit' ? canEdit : canView;
        } }),
      };
      if (name === '@/lib/api') return {
        fetchRadnikKategorijeGorivo: async () => {
          calls.push(['categories']);
          if (loadError) throw loadError;
          return categories;
        },
        fetchRadnikGorivoVehicleTypes: async () => { calls.push(['types']); return ['Teretno', 'Putničko']; },
        updateRadnikKategorijaGorivoTypes: async (...args) => {
          calls.push(['save', ...args]);
          if (saveError) throw saveError;
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => { cursor = 0; return module.exports.FuelCategorySettings(); };
  const startEffect = () => effect();
  const flush = async () => { const cleanup = startEffect(); await new Promise(resolve => setImmediate(resolve)); return cleanup; };
  const open = async () => {
    render().props.onToggle({ currentTarget: { open: true } });
    render();
    return flush();
  };
  const saveButton = () => elements(render()).find(node => node.type === 'button'
    && Array.isArray(node.props.children) && node.props.children.includes('Spremi ograničenje'));
  return { states, calls, render, startEffect, flush, open, saveButton };
}

test('fuel restrictions live in Vehicles, not the staff list', () => {
  const vehicles = readFileSync(new URL('../src/components/views/VozilaView.tsx', import.meta.url), 'utf8');
  const workers = readFileSync(new URL('../src/components/views/RadniciView.tsx', import.meta.url), 'utf8');
  assert.match(vehicles, /<FuelCategorySettings \/>/);
  assert.doesNotMatch(workers, /Dopušteni tipovi vozila za gorivo|saveFuelCategory|fetchRadnikGorivoVehicleTypes/);
  assert.match(workers, /Dopušteni tipovi za gorivo:/, 'Keep the category hint in worker editing');
});

test('fuel settings are collapsed and make no requests until expanded', async () => {
  const view = setup();
  const tree = view.render();
  assert.equal(tree.type, 'details');
  assert.equal(tree.props.open, false);
  assert.equal(elements(tree).some(node => node.type === 'h2'), false);
  await view.flush();
  assert.deepEqual(view.calls, []);
  await view.open();
  assert.deepEqual(view.calls, [['categories'], ['types']]);
  assert.equal(view.states.selectedCategory, 'Radnik');
  assert.equal(view.states.restricted, true);
  assert.deepEqual(view.states.selectedTypes, ['Teretno']);
  assert.equal(elements(view.render()).some(node => node.props.className?.includes('max-w-2xl')), true);
});

test('fuel settings preserve category selection, allowed types and unlimited mode', async () => {
  const view = setup();
  await view.open();
  view.states.selectedTypes = ['Teretno', 'Putničko'];
  await view.saveButton().props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(view.calls.at(-1), ['save', 'Radnik', ['Teretno', 'Putničko']]);
  assert.match(view.states.notice, /spremljeni/);
  const select = elements(view.render()).find(node => node.type.name === 'Select');
  select.props.onChange({ target: { value: 'Poslovođa' } });
  assert.equal(view.states.restricted, false);
  await view.saveButton().props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(view.calls.at(-1), ['save', 'Poslovođa', null]);
  view.states.restricted = true;
  view.states.selectedTypes = [];
  const count = view.calls.length;
  assert.equal(view.saveButton().props.disabled, true);
  await view.saveButton().props.onClick();
  assert.equal(view.calls.length, count);
  assert.match(view.states.error, /barem jedan tip/);
});

test('fuel settings keep view/edit gates and show failures without reporting success', async () => {
  const hidden = setup({ canView: false, canEdit: false });
  assert.equal(hidden.render(), null);
  await hidden.flush();
  assert.deepEqual(hidden.calls, []);
  const readOnly = setup({ canEdit: false });
  await readOnly.open();
  assert.equal(readOnly.saveButton(), undefined);
  assert.ok(elements(readOnly.render()).filter(node => node.type === 'input').every(node => node.props.disabled));
  const broken = setup({ loadError: new Error('Nije moguće učitati kategorije.') });
  await broken.open();
  assert.match(broken.states.error, /učitati kategorije/);
  assert.ok(elements(broken.render()).some(node => node.props.role === 'alert'));
  const failedSave = setup({ saveError: new Error('Spremanje nije dopušteno.') });
  await failedSave.open();
  await failedSave.saveButton().props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(failedSave.states.error, /nije dopušteno/);
  assert.equal(failedSave.states.notice, null);
});

test('closing fuel settings cancels the pending load and reopening reloads category data', async () => {
  const view = setup();
  view.render().props.onToggle({ currentTarget: { open: true } });
  view.render();
  const cleanup = view.startEffect();
  cleanup();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.states.categories.length, 0, 'A cancelled request must not populate a closed editor');
  view.render().props.onToggle({ currentTarget: { open: false } });
  view.render();
  await view.flush();
  const count = view.calls.length;
  await view.open();
  assert.equal(view.calls.length, count + 2);
});
