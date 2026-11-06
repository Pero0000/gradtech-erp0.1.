import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

function load(relativePath, mocks, transformers) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    transformers,
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Date,
    window: { dispatchEvent() {} }, Event,
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  return module.exports;
}

const localization = load('../src/lib/localization.ts', {});

test('full dates have padded day/month and a four-digit year', () => {
  assert.equal(localization.formatHrDate('2026-11-04'), '04.11.2026.');
  assert.equal(localization.formatHrDate('2026-01-02'), '02.01.2026.');
  assert.equal(localization.formatHrDate(new Date(2026, 10, 4)), '04.11.2026.');
  assert.equal(localization.formatHrDate('invalid'), '—');
});

test('weekday labels keep Croatian names and a complete numeric date', () => {
  assert.equal(localization.formatHrDate('2026-11-04', { weekday: 'long' }), 'srijeda, 04.11.2026.');
});

test('timestamps retain local time and the European date', () => {
  const date = new Date(2026, 10, 4, 15, 6, 7);
  assert.equal(localization.formatHrDateTime(date), '04.11.2026. 15:06:07');
  assert.equal(localization.formatHrDateTime(date, { hour: '2-digit', minute: '2-digit' }), '04.11.2026. 15:06');
});

test('decimal input accepts comma, point and surrounding whitespace without partial parsing', () => {
  for (const value of ['42,5', '42.5', ' 42,50 ', '42.50', '42']) {
    assert.equal(localization.parseDecimalInput(value), value.trim() === '42' ? 42 : 42.5);
  }
  for (const value of ['', ' ', '42,5.0', '42.5,0', '42,5 l', '1e3', '-1', '1,2,3', 'Infinity']) {
    assert.ok(Number.isNaN(localization.parseDecimalInput(value)), value);
  }
});

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...elements(node.props.children)];
}

function fuelForm(mobile, liters, pin = null) {
  const writes = [];
  const worker = {
    id: 'worker', ime: 'Test', prezime: 'Worker', uloga: 'radnik',
    dozvoljeni_tipovi_vozila: ['teretno'],
  };
  const vehicle = {
    id: 'vehicle', tip: 'teretno', kilometraza: 100000,
    marka: 'Test', model: 'Auto', registracija: 'TEST-1', gorivo_pin: pin,
  };
  const fixtures = {
    entries: [], workers: [worker], loading: false, datum: '2026-11-04',
    litara: liters, kilometraza: '100000', tocioId: 'worker', voziloId: 'vehicle',
    options: { vozila: [vehicle], radnici: [worker] },
  };
  const mocks = {
    'react/jsx-runtime': jsxRuntime,
    react: { useState: (value) => [value, () => {}], useEffect() {}, useMemo: (fn) => fn() },
    'lucide-react': { Fuel() {}, Gauge() {}, Plus() {}, RefreshCw() {}, AlertTriangle() {}, Pencil() {}, Trash2() {} },
    '@/lib/localization': localization,
    '@/lib/rokovi': { todayISO: () => '2026-11-04' },
    '@/components/ui/Field': { TextInput() {}, Select() {} },
    '@/components/views/FuelChangeHistory': { FuelChangeHistory() {} },
    '@/lib/api': {
      addVoziloGorivo: async (input) => writes.push(input),
      addMobileVoziloGorivo: async (input) => writes.push(input),
      fetchVoziloGorivo: async () => [], fetchMobileVoziloGorivo: async () => [],
      fetchVozilaGorivoWorkers: async () => [worker], fetchVozilaGorivoAnomalyThreshold: async () => 50,
      fetchMobileVoziloGorivoOptions: async () => fixtures.options,
    },
  };
  const transformers = { before: [(context) => {
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
  }] };
  const module = load(mobile ? '../src/components/mobile/MobileFuelTab.tsx' : '../src/components/views/VoziloGorivo.tsx', mocks, transformers);
  const tree = mobile ? module.MobileFuelTab() : module.VoziloGorivo({ vozilo: vehicle, canEdit: true });
  const nodes = elements(tree);
  return { writes, nodes };
}

for (const pin of ['0012', null]) {
  test(`mobile fuel vehicle option shows ${pin === null ? 'no PIN suffix when unset' : 'the exact PIN without an explanation'}`, () => {
    const { nodes } = fuelForm(true, '42,5', pin);
    const option = nodes.find((node) => node.type === 'option' && node.props.value === 'vehicle');
    const text = option.props.children.join('');
    assert.equal(text, `Test Auto · TEST-1${pin ? ` · ${pin}` : ''}`);
    assert.doesNotMatch(text, /pin|gorivo/i);
  });
}

for (const mobile of [false, true]) {
  for (const liters of ['42,5', '42.5', '42,5.0', '0', '-2']) {
    test(`${mobile ? 'mobile' : 'web'} fuel save validates and converts "${liters}"`, async () => {
      const { writes, nodes } = fuelForm(mobile, liters);
      const input = nodes.find((node) => node.props.placeholder === 'npr. 42,5');
      assert.equal(input.props.type, 'text');
      assert.equal(input.props.inputMode, 'decimal');
      const saveButton = nodes.find((node) => node.type === 'button'
        && Array.isArray(node.props.children)
        && node.props.children.includes(mobile ? 'Spremi točenje' : 'Dodaj točenje'));
      assert.ok(saveButton, 'Save action must exist');
      saveButton.props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
      if (liters === '42,5' || liters === '42.5') {
        assert.equal(writes.length, 1);
        assert.equal(writes[0].litara, 42.5);
        assert.equal(writes[0].datum, '2026-11-04');
      } else {
        assert.equal(writes.length, 0, 'Invalid quantities must not reach the API');
      }
    });
  }
}
