import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(`${source}\nexport { syncZadnjuKilometrazuVozila };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function setup({ currentKm = 100000, orders = [], updateError = null, beforeUpdate } = {}) {
  const vehicle = { id: 'vehicle', kilometraza: currentKm };
  const fuelWrites = [];
  const module = { exports: {} };
  const supabase = {
    rpc: async (name, payload) => {
      assert.equal(name, 'add_mobile_vozila_gorivo');
      fuelWrites.push(payload);
      return { error: null };
    },
    from: (table) => {
      let payload;
      let operation = 'select';
      const filters = [];
      const query = {
        select: () => query,
        order: () => query,
        not: () => query,
        in: () => query,
        eq: (key, value) => { filters.push((row) => row[key] === value); return query; },
        lt: (key, value) => { filters.push((row) => row[key] < value); return query; },
        insert: (value) => { operation = 'insert'; payload = value; return query; },
        update: (value) => { operation = 'update'; payload = value; return query; },
        then: (resolve, reject) => {
          let data = null;
          if (table === 'dnevni_raspored_gradilista') {
            data = orders.map((order) => ({ nalog_id: order.id, datum: order.datum }));
          } else if (table === 'radni_nalozi') {
            data = orders;
          } else if (table === 'vozila') {
            assert.equal(operation, 'update');
            beforeUpdate?.(vehicle);
            if (!updateError && filters.every((filter) => filter(vehicle))) Object.assign(vehicle, payload);
          } else {
            assert.equal(table, 'vozila_gorivo');
            fuelWrites.push(payload);
          }
          return Promise.resolve({ data, error: table === 'vozila' ? updateError : null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const mocks = {
    './supabase': { supabase },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {},
    './company': {}, './pagination': {}, './rokovi': {}, './imageCompression': {},
  };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  return { api: module.exports, vehicle, fuelWrites };
}

const order = (id, km, datum) => ({ id, km_kraj: km, datum, datum_kreiranja: datum });

test('late fuel readings are sent unchanged by web insert, edit and mobile RPC', async () => {
  const { api, fuelWrites } = setup();
  const input = {
    vozilo_id: 'vehicle', datum: '2026-11-01', litara: 40, kilometraza: 99500,
    tocio_radnik_id: 'worker', tocio_ime: 'Test Worker',
  };
  await api.addVoziloGorivo(input);
  await api.updateVoziloGorivo('fuel', input);
  await api.addMobileVoziloGorivo(input);
  assert.equal(fuelWrites[0].kilometraza, 99500);
  assert.equal(fuelWrites[1].kilometraza, 99500);
  assert.equal(fuelWrites[2].p_kilometraza, 99500);
  assert.equal(fuelWrites[2].p_datum, input.datum);
});

for (const km of [99500, 100000, 100200]) {
  test(`order mileage ${km} only raises the vehicle reading when greater`, async () => {
    const { api, vehicle } = setup({ orders: [order('order', km, '2026-11-04')] });
    await api.syncZadnjuKilometrazuVozila('vehicle');
    assert.equal(vehicle.kilometraza, Math.max(100000, km));
  });
}

test('highest completed order reading wins even if a newer order has fewer kilometres', async () => {
  const { api, vehicle } = setup({
    orders: [order('new', 100100, '2026-11-04'), order('old', 100300, '2026-11-01')],
  });
  await api.syncZadnjuKilometrazuVozila('vehicle');
  assert.equal(vehicle.kilometraza, 100300);
});

test('a concurrent higher fuel reading is not overwritten by order synchronization', async () => {
  const { api, vehicle } = setup({
    orders: [order('order', 100200, '2026-11-04')],
    beforeUpdate: (row) => { row.kilometraza = 100500; },
  });
  await api.syncZadnjuKilometrazuVozila('vehicle');
  assert.equal(vehicle.kilometraza, 100500);
});

test('order mileage update failures remain visible to the caller', async () => {
  const error = { message: 'Update denied' };
  const { api } = setup({ orders: [order('order', 100200, '2026-11-04')], updateError: error });
  await assert.rejects(api.syncZadnjuKilometrazuVozila('vehicle'), (reason) => reason === error);
});
