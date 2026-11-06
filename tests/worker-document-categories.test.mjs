import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

function load(file, mocks, fixtures = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    transformers: { before: [(context) => {
      function visit(node) {
        if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer
          && ts.isCallExpression(node.initializer) && node.initializer.expression.getText() === 'useState') {
          const name = node.name.elements[0].name.getText();
          if (Object.hasOwn(fixtures, name)) {
            return context.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
              context.factory.updateCallExpression(node.initializer, node.initializer.expression, node.initializer.typeArguments, [
                context.factory.createCallExpression(context.factory.createPropertyAccessExpression(
                  context.factory.createIdentifier('JSON'), 'parse'), undefined, [
                  context.factory.createStringLiteral(JSON.stringify(fixtures[name])),
                ]),
              ]));
          }
        }
        return ts.visitEachChild(node, visit, context);
      }
      return (node) => ts.visitNode(node, visit);
    }] },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  return module.exports;
}

const definitions = load('../src/lib/radnikDokumenti.ts', {});
const custom = { vrsta: 'custom:category-id', naziv: 'Rad na visini' };

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...nodes(node.props.children)];
}

function form(canEdit, vrsta = custom.vrsta, categoryDraft = '') {
  const writes = [];
  const errors = [];
  const module = load('../src/components/views/RadnikDokumenti.tsx', {
    'react/jsx-runtime': jsxRuntime,
    react: {
      useState: (value) => [value, (next) => { if (typeof next === 'string') errors.push(next); }],
      useEffect() {}, useRef: () => ({ current: null }), useCallback: (fn) => fn,
    },
    'lucide-react': { FileText() {}, Plus() {}, Trash2() {}, Paperclip() {} },
    '@/lib/localization': { formatHrDate: () => '' },
    '@/lib/rokovi': { todayISO: () => '2026-11-04' },
    '@/lib/radnikDokumenti': definitions,
    '@/auth/useAuth': { useAuth: () => ({ canAccess: () => canEdit }) },
    '@/components/ui/Field': { TextInput() {}, Select() {} },
    '@/components/views/FuelChangeHistory': { DocumentChangeHistoryPanel() {} },
    '@/lib/useRequestScope': { useRequestScope: () => ({ start: () => () => true, invalidate() {} }) },
    '@/lib/api': {
      fetchRadnikDokumenti: async () => [],
      addRadnikDokument: async (...args) => writes.push(args),
      addRadnikDokumentKategorija: async (name) => { writes.push(name); return custom; },
    },
  }, {
    categories: [...definitions.osnovneDokumentKategorije, custom], categoriesReady: true,
    categoryDraft, form: { vrsta, datum_od: '2026-11-04', datum_do: '2027-11-04' },
  });
  return { elements: nodes(module.RadnikDokumenti({ radnikId: 'worker' })), writes, errors };
}

test('custom category supplies document name, dates and worker ID without a separate name input', async () => {
  const { elements, writes } = form(true);
  assert.ok(!elements.some((node) => node.props.placeholder === 'Naziv (neobavezno)'));
  const save = elements.find((node) => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('Dodaj'));
  assert.ok(save);
  save.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes[0][0], 'worker');
  assert.equal(writes[0][1].naziv, 'Rad na visini');
  assert.equal(writes[0][1].vrsta, custom.vrsta);
  assert.equal(writes[0][1].datum_do, '2027-11-04');
});

test('standard medical category retains its original key and supplies its name', async () => {
  const { elements, writes } = form(true, 'lijecnicki');
  elements.find((node) => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('Dodaj')).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes[0][1].vrsta, 'lijecnicki');
  assert.equal(writes[0][1].naziv, 'Liječnički pregled');
});

test('training replaces legacy attestations in the document picker and saves its own key', async () => {
  const { elements, writes } = form(true, 'osposobljavanje');
  const options = elements.filter((node) => node.type === 'option');
  assert.ok(options.some((node) => node.props.value === 'osposobljavanje' && node.props.children === 'Osposobljavanje'));
  assert.ok(!options.some((node) => node.props.value === 'atest'));
  assert.equal(definitions.dokumentVrste.atest, 'Atest');
  elements.find((node) => node.type === 'button' && Array.isArray(node.props.children) && node.props.children.includes('Dodaj')).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes[0][1].vrsta, 'osposobljavanje');
  assert.equal(writes[0][1].naziv, 'Osposobljavanje');
});

function readiness(documents, status = 'aktivan') {
  const module = load('../src/components/views/RadnikDetalj.tsx', {
    'react/jsx-runtime': jsxRuntime,
    react: { useState: (value) => [value, () => {}], useEffect() {}, useMemo: (fn) => fn() },
    'lucide-react': { Activity() {}, BadgeCheck() {}, FileText() {}, Wallet() {} },
    '@/lib/localization': { formatHrDate: () => 'datum' },
    '@/lib/api': {},
    '@/lib/obracunSati': {
      hrPraznici: () => new Set(),
      mjesecRaspon: () => ({ od: '2026-11-01', do: '2026-11-30' }),
      computeObracun: () => ({ iznosi: { ukupno: 0 } }),
      pravaRadnika: () => ({}),
    },
    '@/lib/rokovi': { todayISO: () => '2026-11-04' },
    '@/lib/radnikDokumenti': definitions,
    '@/components/ui/Modal': { Modal() {} },
    './HistoryDialog': { HistoryButton() {}, HistoryDialog() {} },
    '@/components/views/RadnikDokumenti': { RadnikDokumenti() {} },
    '@/components/ui/Badge': { Badge() {} },
  }, { documents });
  return nodes(module.RadnikDetalj({
    radnik: { id: 'worker', ime: 'Ana', prezime: 'Test', uloga: 'Radnik', status, cijena_sata: 0 },
    open: true, onClose() {}, onEdit() {},
  }));
}

for (const [name, training, status, expected] of [
  ['legacy attestation cannot replace missing training', { vrsta: 'atest', datum_do: '2027-01-01' }, 'aktivan', 'Nije spreman za rad'],
  ['expired training blocks readiness', { vrsta: 'osposobljavanje', datum_do: '2026-11-03' }, 'aktivan', 'Nije spreman za rad'],
  ['valid training permits readiness', { vrsta: 'osposobljavanje', datum_do: '2027-01-01' }, 'aktivan', 'Spreman za rad'],
  ['training remains valid on expiry day', { vrsta: 'osposobljavanje', datum_do: '2026-11-04' }, 'aktivan', 'Spreman za rad'],
  ['training without expiry preserves existing document behavior', { vrsta: 'osposobljavanje', datum_do: null }, 'aktivan', 'Spreman za rad'],
  ['inactive workers are not ready despite valid training', { vrsta: 'osposobljavanje', datum_do: '2027-01-01' }, 'neaktivan', 'Neaktivan'],
]) {
  test(name, () => {
    const documents = [
      { radnik_id: 'worker', vrsta: 'lijecnicki', datum_do: '2027-01-01' },
      { radnik_id: 'worker', vrsta: 'zastita_na_radu', datum_do: '2027-01-01' },
      { radnik_id: 'worker', ...training },
    ];
    const elements = readiness(documents, status);
    const badge = elements.find((node) => node.type.name === 'Badge');
    assert.equal(badge.props.children, expected);
    assert.ok(elements.some((node) => node.props.children === 'Osposobljavanje'));
    assert.ok(!elements.some((node) => node.props.children === 'Atest'));
  });
}

test('read-only users see no document or category write controls', () => {
  const { elements } = form(false);
  assert.ok(!elements.some((node) => node.type === 'button'));
});

test('duplicate category names are rejected case-insensitively before writing', async () => {
  const { elements, writes, errors } = form(true, custom.vrsta, ' rad NA VISINI ');
  elements.find((node) => node.type === 'button' && node.props.children === 'Dodaj kategoriju').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 0);
  assert.ok(errors.includes('Kategorija dokumenta s tim nazivom već postoji.'));
});

test('a new category is trimmed and passed to the persistence API', async () => {
  const { elements, writes } = form(true, custom.vrsta, ' Novi atest ');
  elements.find((node) => node.type === 'button' && node.props.children === 'Dodaj kategoriju').props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ['Novi atest']);
});

test('different custom categories retain separate expiry notifications', () => {
  const { buildObavijesti } = load('../src/lib/obavijesti.ts', {
    './company': {}, '@/lib/api': {}, '@/lib/servis': {},
    '@/lib/rokovi': { todayISO: () => '2026-11-04' },
    '@/lib/postavke': { obavijestTipovi: [{ tip: 'radnik_ostalo', grupa: 'radnici', label: 'Ostalo' }] },
  });
  const result = buildObavijesti({
    radnici: [{ id: 'worker', ime: 'Test', prezime: 'Worker', status: 'aktivan' }],
    radnikDok: [
      { id: 'first', radnik_id: 'worker', vrsta: 'custom:first', naziv: 'Prva', datum_do: '2026-11-05' },
      { id: 'second', radnik_id: 'worker', vrsta: 'custom:second', naziv: 'Druga', datum_do: '2026-11-06' },
    ],
    vozila: [], voziloDok: [], gradilista: [], rokovi: [], fakture: [], voziloObavijesti: [], gorivoAnomalije: [],
  }, { obavijesti: { radnik_ostalo: { on: true, dana: 30 }, vozilo_servis: { on: false } } });
  assert.equal(result.length, 2);
  assert.deepEqual(Array.from(result, (item) => item.detail).sort(), ['Druga', 'Prva']);
});
