import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/vehicleKmCosts.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports });
const { calculateDailyVehicleKmCosts, calculateVehicleKmCosts } = module.exports;

const orders = [
  { id: 'nalog-1', broj: '001', gradiliste_id: 'site-1', km_pocetak: 1000, km_kraj: 1150 },
  { id: 'nalog-2', broj: '002', gradiliste_id: 'site-2', km_pocetak: 1150, km_kraj: 1230 },
];

test('obračunava kilometre zasebno po cijeni svakog vozila, uključujući Vivaro', () => {
  const vehicles = [
    { marka: 'Opel', model: 'Vivaro', cijena_km: 0.5 },
    { marka: 'Ford', model: 'Transit', cijena_km: 0.75 },
    { marka: 'Iveco', model: 'Daily', cijena_km: 1.1 },
  ];
  const costs = vehicles.map((vehicle) => calculateVehicleKmCosts(orders, vehicle));

  assert.deepEqual(costs.map((rows) => rows.reduce((sum, row) => sum + row.iznos, 0)), [115, 172.5, 253]);
  assert.ok(costs[0].every((row) => row.opis.includes('Opel Vivaro')));
  assert.ok(costs[1].every((row) => row.opis.includes('Ford Transit')));
  assert.ok(costs[2].every((row) => row.opis.includes('Iveco Daily')));
});

test('dnevni obračun zadržava kilometre iz upisa za svako vozilo', () => {
  const assignments = [
    { nalog_id: 'nalog-1', vozilo_id: 'vivaro', gradiliste_id: 'site-vivaro' },
    { nalog_id: 'nalog-2', vozilo_id: 'transit', gradiliste_id: 'site-transit' },
  ];
  const vehicleOrders = [
    { id: 'nalog-1', broj: '001', gradiliste_id: 'stale-site', km_pocetak: 1000, km_kraj: 1150 },
    { id: 'nalog-2', broj: '002', gradiliste_id: null, km_pocetak: 2000, km_kraj: 2230 },
  ];
  const vehicles = [
    { id: 'vivaro', marka: 'Opel', model: 'Vivaro', cijena_km: 0.5 },
    { id: 'transit', marka: 'Ford', model: 'Transit', cijena_km: 0.75 },
  ];
  const costs = calculateDailyVehicleKmCosts(assignments, vehicleOrders, vehicles);

  assert.deepEqual(JSON.parse(JSON.stringify(costs.map((row) => [row.nalog_id, row.km, row.iznos]))), [
    ['nalog-1', 150, 75],
    ['nalog-2', 230, 172.5],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(costs.map((row) => row.gradiliste_id))), ['site-vivaro', 'site-transit']);
});

test('dnevni obračun čuva kilometre upisane po nalogu za tri gradilišta', () => {
  const assignments = [
    { nalog_id: 'nalog-1', vozilo_id: 'vivaro', gradiliste_id: 'site-1' },
    { nalog_id: 'nalog-2', vozilo_id: 'vivaro', gradiliste_id: 'site-2' },
    { nalog_id: 'nalog-3', vozilo_id: 'vivaro', gradiliste_id: 'site-3' },
  ];
  const vehicleOrders = [
    { id: 'nalog-1', broj: '001', gradiliste_id: 'site-1', km_pocetak: 1000, km_kraj: 1150 },
    { id: 'nalog-2', broj: '002', gradiliste_id: 'site-2', km_pocetak: 1150, km_kraj: 1230 },
    { id: 'nalog-3', broj: '003', gradiliste_id: 'site-3', km_pocetak: 1230, km_kraj: 1400 },
  ];
  const costs = calculateDailyVehicleKmCosts(assignments, vehicleOrders, [
    { id: 'vivaro', marka: 'Opel', model: 'Vivaro', cijena_km: 0.5 },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(costs.map((row) => [row.nalog_id, row.km, row.iznos]))), [
    ['nalog-1', 150, 75],
    ['nalog-2', 80, 40],
    ['nalog-3', 170, 85],
  ]);
  assert.equal(costs.reduce((sum, row) => sum + row.iznos, 0), 200);
});

test('dnevni obračun bez ručne podjele čuva izračun svakog naloga i gradilišta', () => {
  const costs = calculateDailyVehicleKmCosts([
    { nalog_id: 'nalog-1', vozilo_id: 'vivaro', gradiliste_id: 'site-1' },
    { nalog_id: 'nalog-2', vozilo_id: 'vivaro', gradiliste_id: 'site-1' },
    { nalog_id: 'nalog-3', vozilo_id: 'vivaro', gradiliste_id: 'site-2' },
  ], [
    { id: 'nalog-1', broj: '001', gradiliste_id: 'site-1', km_pocetak: 1000, km_kraj: 1100 },
    { id: 'nalog-2', broj: '002', gradiliste_id: 'site-1', km_pocetak: 1100, km_kraj: 1200 },
    { id: 'nalog-3', broj: '003', gradiliste_id: 'site-2', km_pocetak: 1200, km_kraj: 1300 },
  ], [{ id: 'vivaro', marka: 'Opel', model: 'Vivaro', cijena_km: 0.5 }]);

  assert.deepEqual(JSON.parse(JSON.stringify(costs.map((row) => [row.nalog_id, row.gradiliste_id, row.km, row.iznos]))), [
    ['nalog-1', 'site-1', 100, 50],
    ['nalog-2', 'site-1', 100, 50],
    ['nalog-3', 'site-2', 100, 50],
  ]);
});

test('dnevni obračun primjenjuje spremljene postotke', () => {
  const costs = calculateDailyVehicleKmCosts([
    { nalog_id: 'nalog-1', vozilo_id: 'vivaro', gradiliste_id: 'site-1' },
    { nalog_id: 'nalog-2', vozilo_id: 'vivaro', gradiliste_id: 'site-2' },
  ], orders, [{ id: 'vivaro', marka: 'Opel', model: 'Vivaro', cijena_km: 0.5 }], [
    { vozilo_id: 'vivaro', gradiliste_id: 'site-1', postotak: 75 },
    { vozilo_id: 'vivaro', gradiliste_id: 'site-2', postotak: 25 },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(costs.map((row) => [row.km, row.iznos]))), [
    [172.5, 86.25],
    [57.5, 28.75],
  ]);
});

test('dnevni obračun poštuje nulti ručni udio umjesto da ga vrati na 100%', () => {
  const costs = calculateDailyVehicleKmCosts([
    { nalog_id: 'nalog-1', vozilo_id: 'vivaro', gradiliste_id: 'site-1' },
  ], orders.slice(0, 1), [{ id: 'vivaro', marka: 'Opel', model: 'Vivaro', cijena_km: 0.5 }], [
    { vozilo_id: 'vivaro', gradiliste_id: 'site-1', postotak: 0 },
    { vozilo_id: 'vivaro', gradiliste_id: 'site-2', postotak: 100 },
  ]);

  assert.equal(costs.length, 0);
});

test('dnevni obračun normalizira spremljene udjele kada je dio naloga još nezavršen', () => {
  const costs = calculateDailyVehicleKmCosts([
    { nalog_id: 'nalog-1', vozilo_id: 'vivaro', gradiliste_id: 'site-1' },
    { nalog_id: 'nalog-2', vozilo_id: 'vivaro', gradiliste_id: 'site-2' },
  ], orders, [{ id: 'vivaro', marka: 'Opel', model: 'Vivaro', cijena_km: 0.5 }], [
    { vozilo_id: 'vivaro', gradiliste_id: 'site-1', postotak: 50 },
    { vozilo_id: 'vivaro', gradiliste_id: 'site-2', postotak: 30 },
    { vozilo_id: 'vivaro', gradiliste_id: 'site-3', postotak: 20 },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(costs.map((row) => [row.km, row.iznos]))), [
    [143.75, 71.88],
    [86.25, 43.12],
  ]);
  assert.equal(costs.reduce((sum, row) => sum + row.iznos, 0), 115);
});

test('dnevni obračun koristi jednaku raspodjelu kada spremljeni udjeli nisu potpuni', () => {
  const costs = calculateDailyVehicleKmCosts([
    { nalog_id: 'nalog-1', vozilo_id: 'vivaro', gradiliste_id: 'site-1' },
    { nalog_id: 'nalog-2', vozilo_id: 'vivaro', gradiliste_id: 'site-2' },
  ], orders, [{ id: 'vivaro', marka: 'Opel', model: 'Vivaro', cijena_km: 0.5 }], [
    { vozilo_id: 'vivaro', gradiliste_id: 'site-1', postotak: 75 },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(costs.map((row) => [row.km, row.iznos]))), [
    [115, 57.5],
    [115, 57.5],
  ]);
});

test('pojedinačni obračun vozila i dalje obračunava kilometre po nalogu', () => {
  const costs = calculateVehicleKmCosts(orders, { marka: 'Opel', model: 'Vivaro', cijena_km: 0.5 });

  assert.deepEqual(JSON.parse(JSON.stringify(costs.map((row) => [row.nalog_id, row.km, row.iznos]))), [
    ['nalog-1', 150, 75],
    ['nalog-2', 80, 40],
  ]);
});

test('ne stvara kilometarski trošak kada cijena nije unesena ili nije valjana', () => {
  for (const cijena_km of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(calculateVehicleKmCosts(orders, { marka: 'Opel', model: 'Vivaro', cijena_km }).length, 0);
  }
});

test('zanemaruje negativne ili nulte kilometre ostalih naloga i zaokružuje iznos na cente', () => {
  const costs = calculateVehicleKmCosts([
    { id: 'nalog-1', broj: '001', gradiliste_id: 'site-1', km_pocetak: 10, km_kraj: 20 },
  ], { marka: 'Opel', model: 'Vivaro', cijena_km: 0.333 });

  assert.deepEqual(JSON.parse(JSON.stringify(costs.map((row) => [row.nalog_id, row.km, row.iznos]))), [['nalog-1', 10, 3.33]]);
});
