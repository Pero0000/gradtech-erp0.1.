import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/obracunSati.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
vm.runInNewContext(outputText, { module, exports: module.exports, require: () => ({}) });
const obracun = module.exports;

const svaPrava = { nocni: true, teren: true, praznik: true, godisnji: true, bolovanje: true };
const cijene = { cijena_sata: 10, nocni_dodatak: 50, teren_dnevnica: 30, cijena_praznik: 80, cijena_godisnji: 70, cijena_bolovanje: 50 };

test('noćne minute pokrivaju ponoć, granice i djelomične noćne smjene', () => {
  for (const [od, doo, ukupno, nocne] of [
    ['22:00', '06:00', 480, 480],
    ['20:00', '04:00', 480, 360],
    ['23:30:00', '06:30:00', 420, 390],
    ['04:00', '08:00', 240, 120],
    ['06:00', '22:00', 960, 0],
    ['21:45', '22:15', 30, 15],
    ['06:00', '06:00', 0, 0],
  ]) {
    assert.deepEqual({ ...obracun.minuteSmjene(od, doo, { nocOd: 1320, danOd: 360 }) },
      { ukupno, nocne }, `${od} – ${doo}`);
  }
  assert.equal(obracun.minuteSmjene('20:00', '08:00', { nocOd: 1260, danOd: 420 }).nocne, 600);
  assert.throws(() => obracun.minuteSmjene('25:00', '06:00', { nocOd: 1320, danOd: 360 }), /Neispravno/);
});

test('portal računa aktualne noćne sate i bez odobrene evidencije, a ručne sate ne skraćuje', async () => {
  const rows = [
    { izvor: 'nalog', vrijeme_od: '22:00', vrijeme_do: '06:00', sati: -16, nocni_sati: 0 },
    { izvor: 'nalog', vrijeme_od: '20:00', vrijeme_do: '04:00', sati: 8, nocni_sati: 2 },
    { izvor: 'nalog', vrijeme_od: '22:00', vrijeme_do: null, sati: null, nocni_sati: 0 },
    { izvor: 'evidencija', sati: 24, nocni_sati: 8 },
    { izvor: 'evidencija', sati: 8, napomena: 'Noćni rad 2.5 h' },
  ];
  const mocks = {
    './supabase': { supabase: { rpc: async (name) => {
      assert.equal(name, 'get_my_radno_vrijeme');
      return { data: rows, error: null };
    } } },
    './postavke': { nocniInterval: () => ({ nocOd: 1320, danOd: 360 }) },
    './obracunSati': obracun,
    './vehicleKmCosts': { calculateVehicleKmCosts: () => [] },
    './company': {},
    './pagination': {},
  };
  const apiSource = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(apiSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const apiModule = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module: apiModule, exports: apiModule.exports,
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  const result = await apiModule.exports.fetchMojeRadnoVrijeme('2026-10-01', '2026-10-31');
  assert.equal(result[0].sati, 8);
  assert.equal(result[0].nocni_sati, 8);
  assert.equal(result[1].sati, 8);
  assert.equal(result[1].nocni_sati, 6);
  assert.equal(result[2].sati, null);
  assert.equal(result[2].nocni_sati, 0);
  assert.equal(result[3].sati, 24);
  assert.equal(result[3].nocni_sati, 8);
  assert.equal(result[4].nocni_sati, 2.5);
  const sum = obracun.computeObracun({
    od: '2026-10-01', do: '2026-10-31',
    unosi: result.slice(0, 2).map((row) => ({ ...row, datum: '2026-10-21', teren: false })),
    odsustva: [], prava: svaPrava,
  });
  assert.equal(sum.redovniSati, 16);
  assert.equal(sum.kolicine.nocni, 14);
});

test('hrvatski praznici uključuju pomične blagdane', () => {
  const p2025 = obracun.hrPraznici(2025);
  assert.equal(p2025.get('2025-04-21'), 'Uskrsni ponedjeljak');
  assert.equal(p2025.get('2025-06-19'), 'Tijelovo');
  assert.equal(p2025.get('2025-05-30'), 'Dan državnosti');
  assert.equal(obracun.hrPraznici(2024).get('2024-04-01'), 'Uskrsni ponedjeljak');
});

test('mjesečni obračun broji radne dane i iznose samo za odobrene kategorije', () => {
  const { od, do: doo } = obracun.mjesecRaspon('2025-05');
  assert.equal(doo, '2025-05-31');
  const result = obracun.computeObracun({
    od, do: doo,
    unosi: [
      { datum: '2025-05-02', sati: 10, nocni_sati: 2, teren: true },
      { datum: '2025-05-05', sati: 8, nocni_sati: 0, teren: false },
      { datum: '2025-04-30', sati: 8, nocni_sati: 8, teren: true },
    ],
    odsustva: [
      { vrsta: 'godisnji', datum_od: '2025-05-26', datum_do: '2025-06-03' },
      { vrsta: 'bolovanje', datum_od: '2025-05-12', datum_do: '2025-05-13' },
    ],
    prava: { ...svaPrava, teren: false },
    cijene,
  });
  assert.equal(result.redovniSati, 18);
  assert.deepEqual({ ...result.kolicine }, { nocni: 2, teren: 1, praznik: 2, godisnji: 4, bolovanje: 2 });
  assert.equal(result.iznosi.redovni, 180);
  assert.equal(result.iznosi.nocni, 10);
  assert.equal(result.iznosi.teren, 0);
  assert.equal(result.iznosi.praznik, 160);
  assert.equal(result.iznosi.godisnji, 280);
  assert.equal(result.iznosi.bolovanje, 100);
  assert.equal(result.iznosi.ukupno, 730);
});

test('praznik na koji je radnik radio ili bio na bolovanju ne broji se kao praznik', () => {
  const result = obracun.computeObracun({
    od: '2025-05-01', do: '2025-05-31',
    unosi: [{ datum: '2025-05-01', sati: 8, nocni_sati: 0, teren: false }],
    odsustva: [{ vrsta: 'bolovanje', datum_od: '2025-05-29', datum_do: '2025-05-30' }],
    prava: svaPrava,
    cijene,
  });
  assert.equal(result.kolicine.praznik, 0);
  assert.equal(result.kolicine.bolovanje, 2);
});

test('teren se broji i za dan s nalogom u tijeku (sati još nisu upisani)', () => {
  const result = obracun.computeObracun({
    od: '2025-05-01', do: '2025-05-31',
    unosi: [
      { datum: '2025-05-06', sati: 0, nocni_sati: 0, teren: true },
      { datum: '2025-05-07', sati: 8, nocni_sati: 6, teren: true },
      { datum: '2025-05-07', sati: 2, nocni_sati: 0, teren: true },
    ],
    odsustva: [],
    prava: svaPrava,
    cijene,
  });
  assert.equal(result.kolicine.teren, 2);
  assert.equal(result.redovniSati, 10);
});

test('prava bez migracije slijede upisane cijene, a nakon migracije spremljene kvačice', () => {
  assert.deepEqual({ ...obracun.pravaRadnika({ nocni_dodatak: 30, teren_dnevnica: 0 }) },
    { nocni: true, teren: false, praznik: false, godisnji: false, bolovanje: false });
  assert.equal(obracun.pravaRadnika({ nocni_dodatak: 30, pravo_nocni: false }).nocni, false);
  assert.equal(obracun.pravaRadnika({ pravo_bolovanje: true }).bolovanje, true);
  assert.equal(obracun.nocniIzNapomene('Ostalo: X · Noćni rad 2.5 h'), 2.5);
  assert.equal(obracun.nocniIzNapomene(null), 0);
});

test('dnevni detalji daju tocan mjesecni zbroj svih kategorija i centi', () => {
  const input = {
    od: '2025-05-01', do: '2025-05-31',
    unosi: [
      { datum: '2025-05-02', sati: 0.33, nocni_sati: 0.13, teren: true },
      { datum: '2025-05-02', sati: 0.33, nocni_sati: 0.13, teren: true },
      { datum: '2025-05-05', sati: 0.33, nocni_sati: 0.13, teren: true },
    ],
    odsustva: [
      { vrsta: 'godisnji', datum_od: '2025-05-23', datum_do: '2025-06-03' },
      { vrsta: 'bolovanje', datum_od: '2025-05-26', datum_do: '2025-05-27' },
    ],
    prava: { ...svaPrava, bolovanje: false },
    cijene: { ...cijene, cijena_sata: 7.33, nocni_dodatak: 33 },
  };
  const days = obracun.computeObracunPoDanima(input);
  const monthly = obracun.computeObracun(input);
  assert.equal(days.length, 31);
  assert.equal(days[0].datum, input.od);
  assert.equal(days.at(-1).datum, input.do);
  const round = (n) => Math.round(n * 100) / 100;
  for (const key of Object.keys(monthly.iznosi)) {
    assert.equal(round(days.reduce((sum, day) => sum + day.obracun.iznosi[key], 0)), monthly.iznosi[key], key);
  }
  for (const key of Object.keys(monthly.kolicine)) {
    assert.equal(round(days.reduce((sum, day) => sum + day.obracun.kolicine[key], 0)), monthly.kolicine[key], key);
  }
  assert.equal(days.find((day) => day.datum === '2025-05-02').obracun.kolicine.teren, 1);
  assert.equal(days.find((day) => day.datum === '2025-05-24').obracun.kolicine.godisnji, 0);
  assert.equal(days.find((day) => day.datum === '2025-05-26').obracun.kolicine.godisnji, 0);
  assert.equal(days.find((day) => day.datum === '2025-05-26').obracun.iznosi.bolovanje, 0);
  assert.equal(days.find((day) => day.datum === '2025-05-30').obracun.kolicine.praznik, 1);
});

test('dnevni detalji prikazuju automatski praznik bez evidencije rada', () => {
  const days = obracun.computeObracunPoDanima({
    od: '2025-05-01', do: '2025-05-01', unosi: [], odsustva: [], prava: svaPrava, cijene,
  });
  assert.equal(days[0].obracun.iznosi.ukupno, 80);
  assert.equal(days[0].obracun.kolicine.praznik, 1);
});

test('evidencija obracuna ucitava gradiliste, nalog i smjenu odgovarajuceg radnika uz stari format nocnih sati', async () => {
  const selections = [];
  const records = [
    {
      id: 'entry', radnik_id: 'worker', datum: '2026-10-02', sati: '8',
      napomena: 'Noćni rad 2.5 h', gradiliste: { naziv: 'Gradiliste A' },
      nalog: { broj: 'RN-1', naslov: 'Bojanje', teren: true, radnici: [
        { radnik_id: 'other', vrijeme_od: '07:00', vrijeme_do: '17:00' },
        { radnik_id: 'worker', vrijeme_od: '20:00', vrijeme_do: '04:00' },
      ] },
    },
    { id: 'manual', radnik_id: 'worker', datum: '2026-10-03', sati: 4, napomena: null, gradiliste: null, nalog: null },
  ];
  const mocks = {
    './supabase': { supabase: { from: (table) => {
      assert.equal(table, 'radno_vrijeme');
      let columns;
      const query = {
        select: (value) => { columns = value; selections.push(value); return query; },
        gte: () => query, lte: () => query, order: () => query, range: () => query,
        returns: async () => columns.includes('nocni_sati')
          ? { data: null, error: { message: 'column nocni_sati does not exist' } }
          : { data: records, error: null },
      };
      return query;
    } } },
    './postavke': {}, './obracunSati': obracun,
    './vehicleKmCosts': { calculateVehicleKmCosts: () => [] }, './company': {},
    './pagination': { fetchAllRows: async (page) => {
      const result = await page(0, 499);
      if (result.error) throw result.error;
      return result.data;
    } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const api = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module: api, exports: api.exports, require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  const result = await api.exports.fetchObracunRadnoVrijeme('2026-10-01', '2026-10-31');
  assert.equal(selections.length, 2);
  assert.equal(result[0].gradiliste_naziv, 'Gradiliste A');
  assert.equal(result[0].nalog_broj, 'RN-1');
  assert.equal(result[0].nalog_naslov, 'Bojanje');
  assert.equal(result[0].vrijeme_od, '20:00');
  assert.equal(result[0].vrijeme_do, '04:00');
  assert.equal(result[0].nocni_sati, 2.5);
  assert.equal(result[0].teren, true);
  assert.equal(result[1].vrijeme_od, null);
  assert.equal(result[1].nalog_broj, null);
});
