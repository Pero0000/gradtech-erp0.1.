import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/lib/mileage.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function load(window = {}) {
  const module = { exports: {} };
  vm.runInNewContext(outputText, { module, exports: module.exports, window });
  return module.exports;
}

test('fuel average excludes anomaly records but keeps normal measurements', () => {
  const componentSource = readFileSync(new URL('../src/components/views/VoziloGorivo.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('VoziloGorivo.tsx', componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'getAverageFuelConsumption');
  const { outputText: functionJs } = ts.transpileModule(
    `${declaration.getText(ast)}\nexport const average = getAverageFuelConsumption;`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  const module = { exports: {} };
  vm.runInNewContext(functionJs, { module, exports: module.exports, Number });
  const average = module.exports.average;

  assert.equal(average([
    { entry: { litara: 40 }, distance: 500, consumption: 8, anomaly: null },
    { entry: { litara: 50 }, distance: 500, consumption: 10, anomaly: null },
    { entry: { litara: 200 }, distance: 100, consumption: 200, anomaly: 'high' },
  ]), 9);
  assert.equal(average([
    { entry: { litara: 200 }, distance: 100, consumption: 200, anomaly: 'high' },
  ]), null);
});

test('large mileage warning starts strictly above 1000 km', () => {
  const { isLargeMileageDifference, mileageDifference } = load();
  assert.equal(mileageDifference('125000', '125999'), 999);
  assert.equal(isLargeMileageDifference('125000', '126000'), false);
  assert.equal(isLargeMileageDifference('125000', '126001'), true);
  assert.equal(isLargeMileageDifference('', '126001'), false);
  assert.equal(isLargeMileageDifference('126001', '125000'), false);
});

test('large mileage requires explicit confirmation while normal distance passes', () => {
  let confirmations = 0;
  const { confirmLargeMileage } = load({
    confirm(message) {
      confirmations += 1;
      assert.match(message, /1.250 km/);
      return false;
    },
  });
  assert.equal(confirmLargeMileage(10000, 10800), true);
  assert.equal(confirmLargeMileage(10000, 11250), false);
  assert.equal(confirmations, 1);
});
