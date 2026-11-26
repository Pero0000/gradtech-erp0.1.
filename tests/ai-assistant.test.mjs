import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/ai.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function loadAi(onInvoke = () => {}) {
  const calls = [];
  const rows = {
    gradilista: [{ id: 'site', naziv: 'Vukovarska', status: 'aktivno', regija: 'zagrebacka', objekti: null }],
    troskovi: [],
    fakture: [],
    rokovi: [],
    radnici: [
      { id: 'worker-1', ime: 'Ivan', prezime: 'Horvat', uloga: 'Zidar', status: 'aktivan' },
      { id: 'worker-2', ime: 'Marko', prezime: 'Ivić', uloga: 'Armirač', status: 'aktivan' },
    ],
    vozila: [],
    kooperanti: [],
    sati: [
      { id: 'r1', radnik_id: 'worker-1', gradiliste_id: 'site', datum: '2026-11-20', sati: 8, nocni_sati: 1, nalog_id: null, napomena: null, created_at: '' },
      { id: 'r2', radnik_id: 'worker-1', gradiliste_id: 'site', datum: '2026-11-19', sati: 7.5, nocni_sati: 0, nalog_id: null, napomena: null, created_at: '' },
      { id: 'r3', radnik_id: 'worker-2', gradiliste_id: null, datum: '2026-10-02', sati: 5, nocni_sati: 0, nalog_id: null, napomena: null, created_at: '' },
    ],
    radnikDokumenti: [],
    voziloDokumenti: [],
  };
  const fetch = (name) => async () => { calls.push(name); return structuredClone(rows[name]); };
  const mocks = {
    '@/lib/api': {
      fetchGradilista: fetch('gradilista'),
      fetchTroskovi: fetch('troskovi'),
      fetchFakture: fetch('fakture'),
      fetchRokovi: fetch('rokovi'),
      fetchRadnici: fetch('radnici'),
      fetchVozila: fetch('vozila'),
      fetchKooperanti: fetch('kooperanti'),
      fetchRadnoVrijeme: fetch('sati'),
      fetchSviRadnikDokumenti: fetch('radnikDokumenti'),
      fetchSviVoziloDokumenti: fetch('voziloDokumenti'),
      iznosFakture: (invoice) => invoice.iznos,
    },
    '@supabase/supabase-js': { FunctionsHttpError: class FunctionsHttpError extends Error {} },
    './supabase': { supabase: {
      functions: {
        invoke: async (_name, options) => {
          onInvoke(options.body.request);
          return { data: { candidates: [{ content: { parts: [{ text: 'Odgovor' }] } }] }, error: null };
        },
      },
    } },
    './company': { requireCompany: () => ({ id: 'company-1' }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    Date,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  return { api: module.exports, calls };
}

test('assistant snapshot groups work hours by worker, month and site', async () => {
  const { api } = loadAi();
  const snapshot = await api.buildSnapshot();
  const ivan = snapshot.radnici.find((worker) => worker.ime === 'Ivan Horvat');
  const marko = snapshot.radnici.find((worker) => worker.ime === 'Marko Ivić');
  assert.equal(ivan.ukupno_sati, 15.5);
  assert.equal(ivan.ukupno_nocni_sati, 1);
  assert.equal(ivan.zadnji_datum_rada, '2026-11-20');
  assert.deepEqual(JSON.parse(JSON.stringify(ivan.mjeseci)), [{
    mjesec: '2026-11',
    sati: 15.5,
    nocni_sati: 1,
    gradilista: ['Vukovarska'],
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(marko.gradilista)), [{ gradiliste: 'Bez gradilišta', sati: 5 }]);
  assert.equal(snapshot.gradilista[0].radni_sati, 15.5);
});

test('assistant reuses snapshot and starts a new load only after invalidation', async () => {
  const { api, calls } = loadAi();
  const first = await api.buildSnapshot();
  const second = await api.buildSnapshot();
  assert.equal(first, second);
  assert.equal(calls.length, 10);
  api.invalidateAiSnapshot();
  await api.buildSnapshot();
  assert.equal(calls.length, 20);
});

test('assistant sends only recent conversation turns', async () => {
  let request;
  const { api } = loadAi((body) => { request = body; });
  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? 'model' : 'user',
    text: String(index),
  }));
  await api.askAi(history, { podaci: true }, false);
  assert.equal(request.contents.length, 8);
  assert.deepEqual(request.contents.map((item) => item.parts[0].text), ['4', '5', '6', '7', '8', '9', '10', '11']);
});

test('assistant surfaces Edge Function response body for non-2xx responses', async () => {
  const mocks = {
    '@/lib/api': {},
    '@supabase/supabase-js': { FunctionsHttpError: class FunctionsHttpError extends Error {} },
    './supabase': { supabase: {
      functions: {
        invoke: async () => ({
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: new Response(JSON.stringify({ error: 'Račun je prevelik za AI analizu.' }), { status: 413 }),
          },
        }),
      },
    } },
    './company': { requireCompany: () => ({ id: 'company-1' }) },
  };
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    },
    Response,
  });
  await assert.rejects(
    module.exports.generateGeminiContent('kooperant-invoice', {}),
    (reason) => reason.status === 413 && reason.message === 'Račun je prevelik za AI analizu.',
  );
});
