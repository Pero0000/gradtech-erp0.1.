import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/useRequestScope.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
vm.runInNewContext(outputText, {
  module, exports: module.exports,
  require: (name) => {
    assert.equal(name, 'react');
    return {};
  },
});
const { createRequestScope } = module.exports;

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}

test('only the latest request can update the view, even when the oldest finishes last', async () => {
  const scope = createRequestScope();
  scope.activate();
  const applied = [];
  const run = async (result) => {
    const isCurrent = scope.start();
    const value = await result;
    if (isCurrent()) applied.push(value);
  };
  const older = deferred();
  const newer = deferred();
  const first = run(older.promise);
  const second = run(newer.promise);
  newer.resolve('saved data');
  await second;
  older.resolve('old data');
  await first;
  assert.deepEqual(applied, ['saved data']);
});

test('a stale failure cannot replace a newer result or clear its loading indicator', async () => {
  const scope = createRequestScope();
  scope.activate();
  const older = deferred();
  const isOlderCurrent = scope.start();
  let error = null;
  let loading = true;
  const first = (async () => {
    try {
      await older.promise;
      throw new Error('old request failed');
    } catch (reason) {
      if (isOlderCurrent()) error = reason;
    } finally {
      if (isOlderCurrent()) loading = false;
    }
  })();
  const isNewerCurrent = scope.start();
  older.resolve();
  await first;
  assert.equal(error, null);
  assert.equal(loading, true);
  assert.equal(isNewerCurrent(), true);
});

test('unmount invalidates pending responses and requests started by late save callbacks', () => {
  const scope = createRequestScope();
  scope.activate();
  const isCurrent = scope.start();
  scope.deactivate();
  assert.equal(isCurrent(), false);
  assert.equal(scope.start()(), false);
});

test('StrictMode cleanup and reactivation do not revive the initial request', () => {
  const scope = createRequestScope();
  scope.activate();
  const initial = scope.start();
  scope.deactivate();
  scope.activate();
  const next = scope.start();
  assert.equal(initial(), false);
  assert.equal(next(), true);
});

test('effect dependency cleanup invalidates results without disabling the next load', () => {
  const scope = createRequestScope();
  scope.activate();
  const initial = scope.start();
  scope.invalidate();
  assert.equal(initial(), false);
  assert.equal(scope.start()(), true);
});

test('independent loading scopes do not discard each other’s results', () => {
  const list = createRequestScope();
  const deadlines = createRequestScope();
  list.activate();
  deadlines.activate();
  const listRequest = list.start();
  const deadlineRequest = deadlines.start();
  list.start();
  assert.equal(listRequest(), false);
  assert.equal(deadlineRequest(), true);
});
