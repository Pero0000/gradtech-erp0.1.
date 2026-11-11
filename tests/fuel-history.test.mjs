import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

function load(file, mocks, fixtures = {}, globals = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    transformers: { before: [(context) => {
      const visit = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer
          && ts.isCallExpression(node.initializer) && node.initializer.expression.getText() === 'useState') {
          const name = node.name.elements[0].name.getText();
          if (Object.hasOwn(fixtures, name)) {
            return context.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
              context.factory.updateCallExpression(node.initializer, node.initializer.expression, node.initializer.typeArguments, [
                context.factory.createCallExpression(context.factory.createPropertyAccessExpression(
                  context.factory.createIdentifier('JSON'), 'parse'), undefined,
                [context.factory.createStringLiteral(JSON.stringify(fixtures[name]))]),
              ]));
          }
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (node) => ts.visitNode(node, visit);
    }] },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports, Date, ...globals,
    require: (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === './HistoryDialog' || name === '@/components/views/HistoryDialog') {
        return {
          HistoryButton() {},
          HistoryDialog() {},
          HistoryMenu({ children }) { return children; },
        };
      }
      assert.ok(false, `Unexpected import: ${name}`);
    },
  });
  return module.exports;
}

function apiSetup(result) {
  const calls = [];
  const api = load('../src/lib/api.ts', {
    './supabase': { supabase: { rpc: async (...args) => { calls.push(args); return result; } } },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
    './pagination': {}, './rokovi': {}, './imageCompression': {},
  });
  return { api, calls };
}

function taskCopyApiSetup(result) {
  const calls = [];
  const api = load('../src/lib/api.ts', {
    './supabase': {
      supabase: {
        from: (table) => ({
          upsert: async (rows, options) => {
            calls.push({ table, rows, options });
            return result;
          },
        }),
      },
    },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
    './pagination': {}, './rokovi': {}, './imageCompression': {},
  });
  return { api, calls };
}

test('history RPC uses vehicle scope and lossless sequence pagination', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.fetchFuelChangeHistory('vehicle');
  await api.fetchFuelChangeHistory('vehicle', '9007199254740993');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_fuel_change_history', { p_vehicle_id: 'vehicle', p_before_sequence: null }],
    ['get_fuel_change_history', { p_vehicle_id: 'vehicle', p_before_sequence: '9007199254740993' }],
  ]);
});

test('mobile fuel option RPC errors identify the migration needed for each dropdown', async () => {
  for (const [missingFunction, expectedMigration] of [
    ['get_vozila_gorivo_workers', '20261110390000_radnik_gorivo_tipovi_vozila.sql'],
    ['get_mobile_vozila_gorivo_vehicles', '20261110390000_radnik_gorivo_tipovi_vozila.sql'],
  ]) {
    const api = load('../src/lib/api.ts', {
      './supabase': {
        supabase: {
          rpc: async (name) => name === missingFunction
            ? {
              data: null,
              error: { code: 'PGRST202', message: `Could not find function public.${name} in the schema cache` },
            }
            : {
              data: name === 'get_vozila_gorivo_workers'
                ? [{ id: 'worker', ime: 'Ana', prezime: 'Test', uloga: 'Radnik', dozvoljeni_tipovi_vozila: ['Teretno'] }]
                : null,
              error: null,
            },
        },
      },
      './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
      './pagination': {}, './rokovi': {}, './imageCompression': {},
    });
    await assert.rejects(api.fetchMobileVoziloGorivoOptions(), new RegExp(expectedMigration));
  }
});

test('mobile fuel vehicle options are requested for the selected worker category', async () => {
  const calls = [];
  const api = load('../src/lib/api.ts', {
    './supabase': {
      supabase: {
        rpc: async (name, args) => {
          calls.push([name, args]);
          if (name === 'get_vozila_gorivo_workers') {
            return {
              data: [
                { id: 'worker-1', ime: 'Ana', prezime: 'Test', uloga: 'Radnik', dozvoljeni_tipovi_vozila: ['Teretno'] },
                { id: 'worker-2', ime: 'Ivo', prezime: 'Test', uloga: 'Poslovođa', dozvoljeni_tipovi_vozila: null },
              ],
              error: null,
            };
          }
          return {
            data: [{ id: 'vehicle-1', marka: 'Test', model: null, registracija: 'TEST-1', tip: 'Radno', kilometraza: 1200 }],
            error: null,
          };
        },
      },
    },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
    './pagination': {}, './rokovi': {}, './imageCompression': {},
  });
  const options = await api.fetchMobileVoziloGorivoOptions('worker-2');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_vozila_gorivo_workers', null],
    ['get_mobile_vozila_gorivo_vehicles', { p_radnik_id: 'worker-2' }],
  ]);
  assert.equal(options.vozila[0].tip, 'Radno');
  assert.equal(options.radnici[1].dozvoljeni_tipovi_vozila, null);
  calls.length = 0;
  await assert.rejects(api.fetchMobileVoziloGorivoOptions('unavailable-worker'), /djelatnik nije aktivan ili nije dostupan/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['get_vozila_gorivo_workers', null]],
    'An unavailable linked worker must not fall back to another worker or request their permitted vehicles');
});

test('mobile fuel vehicle result type errors identify the corrective migration', async () => {
  const api = load('../src/lib/api.ts', {
    './supabase': {
      supabase: {
        rpc: async () => ({
          data: null,
          error: {
            code: '42804',
            message: 'structure of query does not match function result type: returned type numeric does not match expected type integer in column 6',
          },
        }),
      },
    },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
    './pagination': {}, './rokovi': {}, './imageCompression': {},
  });
  await assert.rejects(api.fetchMobileVoziloGorivoOptions(), /20261110380000_fix_mobile_fuel_vehicle_mileage_type\.sql/);
});

test('copying open tasks to another work order preserves source and copies task details', async () => {
  const { api, calls } = taskCopyApiSetup({ error: null });
  await api.copyOpenNalogZadaci('target-order', 'site', [
    {
      id: 'source-task', nalog_id: 'source-order', gradiliste_id: 'site', naziv: 'Nedovršeni rad',
      gotovo: false, rok: '2026-11-12', kooperant_id: 'contractor', vrsta: 'dodatni',
    },
    {
      id: 'ordinary-task', nalog_id: 'source-order', gradiliste_id: 'site', naziv: 'Radni zadatak',
      gotovo: false, rok: null, kooperant_id: null, vrsta: 'zadatak',
    },
    {
      id: 'legacy-task', nalog_id: 'source-order', gradiliste_id: 'site', naziv: 'Stariji zadatak',
      gotovo: false, rok: null, kooperant_id: null,
    },
    {
      id: 'completed-task', nalog_id: 'source-order', gradiliste_id: 'site', naziv: 'Gotov rad',
      gotovo: true, rok: null, kooperant_id: null, vrsta: 'zadatak',
    },
    {
      id: 'already-target-task', nalog_id: 'target-order', gradiliste_id: 'site', naziv: 'Već na cilju',
      gotovo: false, rok: null, kooperant_id: null, vrsta: 'zadatak',
    },
    {
      id: 'other-site-task', nalog_id: 'source-order', gradiliste_id: 'other-site', naziv: 'Drugo gradilište',
      gotovo: false, rok: null, kooperant_id: null, vrsta: 'zadatak',
    },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    table: 'gradiliste_zadaci',
    rows: [{
      nalog_id: 'target-order',
      gradiliste_id: 'site',
      izvor_zadatak_id: 'source-task',
      naziv: 'Nedovršeni rad',
      rok: '2026-11-12',
      kooperant_id: 'contractor',
      vrsta: 'dodatni',
    }, {
      nalog_id: 'target-order',
      gradiliste_id: 'site',
      izvor_zadatak_id: 'ordinary-task',
      naziv: 'Radni zadatak',
      rok: null,
      kooperant_id: null,
      vrsta: 'zadatak',
    }, {
      nalog_id: 'target-order',
      gradiliste_id: 'site',
      izvor_zadatak_id: 'legacy-task',
      naziv: 'Stariji zadatak',
      rok: null,
      kooperant_id: null,
      vrsta: 'zadatak',
    }],
    options: { onConflict: 'nalog_id,izvor_zadatak_id', ignoreDuplicates: true },
  }]);
});

test('restore RPC sends only the history identifier, never client supplied snapshots', async () => {
  const { api, calls } = apiSetup({ error: null });
  await api.restoreFuelChange('history');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['restore_fuel_change', { p_history_id: 'history' }]]);
});

test('permission, conflict and expiry errors reach callers unchanged', async () => {
  for (const code of ['42501', '40001', 'P0001']) {
    const error = { code, message: 'Restore rejected' };
    const { api } = apiSetup({ error });
    await assert.rejects(api.restoreFuelChange('history'), (reason) => reason === error);
    await assert.rejects(api.fetchFuelChangeHistory('vehicle'), (reason) => reason === error);
  }
});

test('missing migration is an explicit error, not an empty successful history', async () => {
  const { api } = apiSetup({ error: { code: 'PGRST202', message: 'RPC not found' } });
  await assert.rejects(api.fetchFuelChangeHistory('vehicle'), /20261109200000/);
});

test('private storage URLs are reused, deduplicated and refreshed before expiry', async () => {
  const calls = [];
  let time = 1_000_000;
  let sequence = 0;
  class TestDate extends Date {
    static now() { return time; }
  }
  const api = load('../src/lib/api.ts', {
    './supabase': {
      supabase: {
        storage: {
          from: (bucket) => ({
            createSignedUrl: async (path, expiresIn) => {
              calls.push([bucket, path, expiresIn]);
              return { data: { signedUrl: `https://files.test/${bucket}/${path}?token=${++sequence}` }, error: null };
            },
          }),
        },
      },
    },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
    './pagination': {}, './rokovi': {}, './imageCompression': {},
  }, {}, { Date: TestDate });

  const [first, concurrent] = await Promise.all([
    api.getPrivateFileUrl('company/photo.webp', 120),
    api.getPrivateFileUrl('company/photo.webp', 120),
  ]);
  assert.equal(first, concurrent);
  assert.equal(await api.getPrivateFileUrl('company/photo.webp', 120), first);
  assert.deepEqual(calls, [['nalozi-foto', 'company/photo.webp', 120]]);

  time += 61_000;
  const refreshed = await api.getPrivateFileUrl('company/photo.webp', 120);
  assert.notEqual(refreshed, first);
  assert.equal(calls.length, 2);

  const forced = await api.getPrivateFileUrl('company/photo.webp', 120, true);
  assert.notEqual(forced, refreshed);
  assert.equal(calls.length, 3);

  const otherBucketUrl = await api.getKooperantDokumentUrl('company/document.pdf', 120);
  assert.match(otherBucketUrl, /kooperant-dokumenti/);
  assert.equal(calls.length, 4);
});

test('cooperator invoice recovery RPCs use atomic package identifiers and explicit migration errors', async () => {
  const {api,calls}=apiSetup({data:[],error:null});
  await api.fetchKooperantInvoiceDeletions({id:'older',created_at:'2026-11-05T00:00:00Z'});
  await api.restoreKooperantInvoiceDeletion('deletion');
  await api.deleteKooperantRacun('cooperator','invoice');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['get_kooperant_invoice_deletions',{p_before_time:'2026-11-05T00:00:00Z',p_before_id:'older'}],
    ['restore_resource_deletion',{p_deletion_id:'deletion'}],
    ['delete_kooperant_racun_with_history',{p_kooperant_id:'cooperator',p_invoice_id:'invoice'}],
  ]);
  for(const operation of ['fetchKooperantInvoiceDeletions','restoreKooperantInvoiceDeletion','deleteKooperantRacun']){
    const missing=apiSetup({error:{code:'PGRST202',message:'RPC missing'}}).api;
    await assert.rejects(operation==='fetchKooperantInvoiceDeletions'
      ? missing[operation]() : operation==='deleteKooperantRacun' ? missing[operation]('cooperator','invoice')
        : missing[operation]('deletion'),/20261110210000/);
  }
});

test('cooperator invoice service uploads bytes first then atomically writes its document and cost lines', async () => {
  const calls=[];
  const document={id:'invoice',kooperant_id:'cooperator',vrsta:'racun',naziv:'Račun.pdf',putanja:'company/cooperator/uuid-Ra_un.pdf'};
  const mocks={
    './supabase':{supabase:{
      storage:{from:bucket=>({
        upload:async(...args)=>{calls.push(['upload',bucket,...args]);return{error:null};},
        remove:async(...args)=>{calls.push(['remove',bucket,...args]);return{error:null};},
      })},
      from:table=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),
      rpc:async(...args)=>{calls.push(['rpc',...args]);return{data:document,error:null};},
    }},
    './postavke':{},'./obracunSati':{},'./vehicleKmCosts':{},
    './company':{requireCompany:()=>({id:'company'})},'./pagination':{},'./rokovi':{},'./imageCompression':{},
  };
  const api=load('../src/lib/api.ts',mocks,{}, {crypto:{randomUUID:()=> 'uuid'}});
  const file={name:'Račun.pdf',size:10,type:'application/pdf'};
  const result=await api.saveKooperantRacun({
    kooperantId:'cooperator',gradilisteId:'site',file,brojRacuna:'R-1',datum:'2026-11-05',
    placen:true,placenoAt:'2026-11-05',
    stavke:[{opis:'Rad',iznos:100,kolicina:2,jedinica:'h',jedinicna_cijena:50}],
  });
  assert.equal(result,document);
  assert.equal(calls.length,2,'Only the Storage upload and one atomic database RPC');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),['upload','kooperant-dokumenti','company/cooperator/uuid-Račun.pdf',file,{contentType:'application/pdf',upsert:false}]);
  assert.equal(calls[1][1],'create_kooperant_invoice');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][2])),{
    p_kooperant_id:'cooperator',p_gradiliste_id:'site',p_putanja:'company/cooperator/uuid-Račun.pdf',
    p_naziv:'Račun.pdf',p_broj_racuna:'R-1',p_datum:'2026-11-05',p_placen:true,p_placeno_at:'2026-11-05',
    p_stavke:[{opis:'Rad',iznos:100,kolicina:2,jedinica:'h',jedinicna_cijena:50}],
  });
  const failure={message:'Database rejected invoice'};
  const failedCalls=[];
  const failedApi=load('../src/lib/api.ts',{
    ...mocks,
    './supabase':{supabase:{
      storage:{from:()=>({
        upload:async(...args)=>{failedCalls.push(['upload',...args]);return{error:null};},
        remove:async(...args)=>{failedCalls.push(['remove',...args]);return{error:null};},
      })},
      from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),
      rpc:async()=>({data:null,error:failure}),
    }},
  },{}, {crypto:{randomUUID:()=> 'uuid'}});
  await assert.rejects(failedApi.saveKooperantRacun({
    kooperantId:'cooperator',gradilisteId:'site',file,brojRacuna:null,datum:'2026-11-05',
    placen:false,placenoAt:null,stavke:[{opis:'Rad',iznos:100,kolicina:null,jedinica:null,jedinicna_cijena:100}],
  }),reason=>reason===failure);
  assert.equal(failedCalls[1][0],'remove','Uploaded bytes are cleaned up if the DB transaction fails');
});

const snapshot = { datum: '2026-11-04', litara: 42.5, kilometraza: 99500, tocio_ime: 'Test Worker' };
const change = {
  id: 'history', sequence: '10', operation: 'DELETE', before_data: snapshot, after_data: null,
  actor_name: 'Test', created_at: '2026-11-04T10:00:00Z', expires_at: '2026-12-04T10:00:00Z',
  reversed_at: null, reverses_id: null, can_restore: true,
};
const localization = load('../src/lib/localization.ts', {});
const resourceHistory = load('../src/lib/resourceHistory.ts', { './localization': localization });

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !node.props) return [];
  if (node.type === historyDialogMock.HistoryButton) {
    return nodes(jsxRuntime.jsx('button', { ...node.props, children: 'Povijest' }));
  }
  if (node.type === historyDialogMock.HistoryDialog) {
    return node.props.open
      ? nodes(jsxRuntime.jsxs('div', { children: [node.props.title, node.props.children] }))
      : [];
  }
  return [node, ...nodes(node.props.children)];
}

const historyDialogMock = {
  HistoryButton: (props) => jsxRuntime.jsx('button', { ...props, children: 'Povijest' }),
  HistoryDialog: ({ open, title, children }) => open
    ? jsxRuntime.jsxs('div', { children: [title, children] })
    : null,
};

function historyUI({ confirmation = true, error = null, selected = change, resourceTable, documentTable, deadlineHistory = false, workTimeHistory = false, costHistory = false, invoiceHistory = false, contractedWorkHistory = false, taskHistory = false, orderHistory = false, investorHistory = false, objectHistory = false, cooperatorHistory = false, engagementHistory = false, catalogHistory = false, disabled = false, canEdit = true } = {}) {
  const calls = [];
  const messages = [];
  const states = [];
  const activity = [];
  const permissions = [];
  const module = load('../src/components/views/FuelChangeHistory.tsx', {
    react: {
      useState: (value) => [value, (next) => states.push(next)],
      useEffect() {}, useCallback: (fn) => fn,
    },
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': { RotateCcw() {} },
    './HistoryDialog': historyDialogMock,
    '@/lib/localization': localization,
    '@/lib/resourceHistory': resourceHistory,
    '@/auth/useAuth': { useAuth: () => ({ canAccess: (...args) => { permissions.push(args); return canEdit; } }) },
    '@/lib/useRequestScope': { useRequestScope: () => ({ start: () => () => true, invalidate() {} }) },
    '@/lib/api': {
      fetchFuelChangeHistory: async () => { calls.push('fetch'); return []; },
      restoreFuelChange: async (id) => { calls.push(id); if (error) throw error; },
      fetchResourceChangeHistory: async (...args) => { calls.push(['resource-fetch', ...args]); return []; },
      restoreResourceChange: async (id) => { calls.push(['resource-restore', id]); if (error) throw error; },
      fetchDocumentChangeHistory: async (...args) => { calls.push(['document-fetch', ...args]); return []; },
      restoreDocumentChange: async (id) => { calls.push(['document-restore', id]); if (error) throw error; },
      fetchDeadlineChangeHistory: async (...args) => { calls.push(['deadline-fetch', ...args]); return []; },
      restoreDeadlineChange: async (id) => { calls.push(['deadline-restore', id]); if (error) throw error; },
      fetchWorkTimeChangeHistory: async (...args) => { calls.push(['hours-fetch', ...args]); return []; },
      restoreWorkTimeChange: async (id) => { calls.push(['hours-restore', id]); if (error) throw error; },
      fetchCostChangeHistory: async (...args) => { calls.push(['cost-fetch', ...args]); return []; },
      restoreCostChange: async (id) => { calls.push(['cost-restore', id]); if (error) throw error; },
      fetchInvoiceChangeHistory: async (...args) => { calls.push(['invoice-fetch', ...args]); return []; },
      restoreInvoiceChange: async (id) => { calls.push(['invoice-restore', id]); if (error) throw error; },
      fetchContractedWorkChangeHistory: async (...args) => { calls.push(['work-fetch', ...args]); return []; },
      restoreContractedWorkChange: async (id) => { calls.push(['work-restore', id]); if (error) throw error; },
      fetchTaskChangeHistory: async (...args) => { calls.push(['task-fetch', ...args]); return []; },
      restoreTaskChange: async (id) => { calls.push(['task-restore', id]); if (error) throw error; },
      fetchOrderChangeHistory: async (...args) => { calls.push(['order-fetch', ...args]); return []; },
      restoreOrderChange: async (id) => { calls.push(['order-restore', id]); if (error) throw error; },
      fetchInvestorChangeHistory: async (...args) => { calls.push(['investor-fetch', ...args]); return []; },
      restoreInvestorChange: async (id) => { calls.push(['investor-restore', id]); if (error) throw error; },
      fetchObjectChangeHistory: async (...args) => { calls.push(['object-fetch', ...args]); return []; },
      restoreObjectChange: async (id) => { calls.push(['object-restore', id]); if (error) throw error; },
      fetchCooperatorChangeHistory: async (...args) => { calls.push(['cooperator-fetch', ...args]); return []; },
      restoreCooperatorChange: async (id) => { calls.push(['cooperator-restore', id]); if (error) throw error; },
      fetchEngagementChangeHistory: async (...args) => { calls.push(['engagement-fetch', ...args]); return []; },
      restoreEngagementChange: async (id) => { calls.push(['engagement-restore', id]); if (error) throw error; },
      fetchCatalogChangeHistory: async (...args) => { calls.push(['catalog-fetch', ...args]); return []; },
      restoreCatalogChange: async (id) => { calls.push(['catalog-restore', id]); if (error) throw error; },
    },
  }, { open: true, items: [selected] }, {
    window: { confirm: (message) => { messages.push(message); return confirmation; } },
  });
  const tree = module.FuelChangeHistory({
    vehicleId: 'vehicle', refreshVersion: 0, resourceTable, documentTable, deadlineHistory, workTimeHistory, costHistory, invoiceHistory, contractedWorkHistory, taskHistory, orderHistory, investorHistory, objectHistory, cooperatorHistory, engagementHistory, catalogHistory, disabled,
    onRestoringChange: (value) => activity.push(value),
    onRestore: async () => { calls.push('refresh-parent'); },
  });
  return { elements: nodes(tree), calls, messages, states, activity, permissions,
    panel: module.ResourceChangeHistoryPanel, documentPanel: module.DocumentChangeHistoryPanel, deadlinePanel: module.DeadlineChangeHistoryPanel,
    workTimePanel: module.WorkTimeChangeHistoryPanel, costPanel: module.CostChangeHistoryPanel, invoicePanel: module.InvoiceChangeHistoryPanel,
    contractedPanel: module.ContractedWorkChangeHistoryPanel, taskPanel: module.TaskChangeHistoryPanel, orderPanel: module.OrderChangeHistoryPanel,
    investorPanel: module.InvestorChangeHistoryPanel, objectPanel: module.ObjectChangeHistoryPanel,
    cooperatorPanel: module.CooperatorChangeHistoryPanel, engagementPanel: module.EngagementChangeHistoryPanel,
    catalogPanel: module.CatalogChangeHistoryPanel };
}

test('restore confirmation shows exact before/after values and mileage limitation', async () => {
  const { elements, calls, messages } = historyUI();
  elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['history', 'fetch', 'refresh-parent']);
  assert.match(messages[0], /42,5 l/);
  assert.match(messages[0], /99\.500 km/);
  assert.match(messages[0], /Nema zapisa/);
  assert.match(messages[0], /neće se automatski smanjiti/);
});

test('cancelling restore sends no write', async () => {
  const { elements, calls } = historyUI({ confirmation: false });
  elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, []);
});

test('restore conflict remains visible and never reports success or refreshes parent', async () => {
  const { elements, calls, states } = historyUI({ error: { message: 'Zapis je naknadno promijenjen.' } });
  elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['history']);
  assert.ok(states.includes('Zapis je naknadno promijenjen.'));
  assert.ok(!states.includes('Promjena je vraćena.'));
});

test('an older pending change has a disabled restore control', () => {
  const { elements } = historyUI({ selected: { ...change, can_restore: false } });
  const button = elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu'));
  assert.equal(button.props.disabled, true);
});

test('resource RPC uses an explicit table and record identifier and returns errors unchanged', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.fetchResourceChangeHistory('radnici', 'worker', '9007199254740993');
  await api.restoreResourceChange('resource-event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_resource_change_history', { p_table: 'radnici', p_record_id: 'worker', p_before_sequence: '9007199254740993' }],
    ['restore_resource_change', { p_history_id: 'resource-event' }],
  ]);
  const error = { code: '40001', message: 'Newer change' };
  const failing = apiSetup({ error });
  await assert.rejects(failing.api.restoreResourceChange('id'), (reason) => reason === error);
  const missing = apiSetup({ error: { code: 'PGRST202' } });
  await assert.rejects(missing.api.fetchResourceChangeHistory('radnici', 'id'), /20261109210000/);
});

test('resource differences show exact old/new values without internal timestamps', () => {
  const differences = resourceHistory.resourceHistoryDifferences({
    before_data: { id: 'record', company_id: 'company', kilometraza: 100000, jamstvo_aktivno: false, jamstvo_od: null, updated_at: 'old' },
    after_data: { id: 'record', company_id: 'company', kilometraza: 250000, jamstvo_aktivno: true, jamstvo_od: '2026-11-04', updated_at: 'new' },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(differences)), [
    { key: 'kilometraza', label: 'Kilometraža (km)', before: '100.000', after: '250.000' },
    { key: 'jamstvo_aktivno', label: 'Jamstvo aktivno', before: 'Ne', after: 'Da' },
    { key: 'jamstvo_od', label: 'Početak jamstva', before: '—', after: '04.11.2026.' },
  ]);
});

test('resource confirmation routes to its own restore handler and warns about closing drafts', async () => {
  const selected = {
    ...change, operation: 'UPDATE', before_data: { kilometraza: 100000 },
    after_data: { kilometraza: 250000 }, blocked_reason: null,
  };
  const { elements, calls, messages } = historyUI({ selected, resourceTable: 'vozila' });
  elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [['resource-restore', 'history'], ['resource-fetch', 'vozila', 'vehicle', undefined], 'refresh-parent']);
  assert.match(messages[0], /250\.000 → 100\.000/);
  assert.match(messages[0], /nespremljene izmjene/);
  assert.match(messages[0], /Točenja i kilometri na nalozima ostaju/);
});

test('unsupported resource changes cannot be restored and show their specific reason', () => {
  const selected = {
    ...change, operation: 'UPDATE', before_data: { cijena_sata: 10 }, after_data: { cijena_sata: 20 },
    can_restore: false, blocked_reason: 'Cijene još nisu podržane.',
  };
  const { elements } = historyUI({ selected, resourceTable: 'radnici' });
  assert.equal(elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.disabled, true);
  assert.ok(elements.some((node) => node.props.children === selected.blocked_reason));
});

test('a pending save prevents restore and successful and failed restores release the editor lock', async () => {
  const disabled = historyUI({ disabled: true });
  const button = disabled.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu'));
  assert.equal(button.props.disabled, true);
  await button.props.onClick();
  assert.deepEqual(disabled.calls, []);
  assert.deepEqual(disabled.messages, []);
  for (const error of [null, { message: 'Restore denied' }]) {
    const active = historyUI({ error });
    active.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(active.activity, [true, false]);
  }
});

test('resource history is visible only with edit access to its owning module', () => {
  const denied = historyUI({ canEdit: false });
  assert.equal(denied.panel({ table: 'oprema', recordId: 'tool', module: 'alat', onRestore() {} }), null);
  assert.deepEqual(denied.permissions, [['alat', 'edit']]);
  const allowed = historyUI();
  const panel = allowed.panel({ table: 'oprema', recordId: 'machine', module: 'strojevi', onRestore() {} });
  assert.equal(panel.props.resourceTable, 'oprema');
  assert.equal(panel.props.vehicleId, 'machine');
  assert.deepEqual(allowed.permissions, [['strojevi', 'edit']]);
});

test('document RPC preserves parent scope, lossless pagination and errors', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.fetchDocumentChangeHistory('vozila_dokumenti', 'vehicle', '9007199254740993');
  await api.restoreDocumentChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_document_change_history', { p_table: 'vozila_dokumenti', p_parent_id: 'vehicle', p_before_sequence: '9007199254740993' }],
    ['restore_document_change', { p_history_id: 'event' }],
  ]);
  const denied = { code: '42501', message: 'Denied' };
  await assert.rejects(apiSetup({ error: denied }).api.restoreDocumentChange('event'), (reason) => reason === denied);
  await assert.rejects(apiSetup({ error: { code: 'PGRST202' } }).api.fetchDocumentChangeHistory('radnici_dokumenti', 'worker'), /20261109220000/);
});

test('site history scopes RPC requests and reports the site migration when the older RPC is installed', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.fetchResourceChangeHistory('gradilista', 'site', '9007199254740993');
  await api.restoreResourceChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_resource_change_history', { p_table: 'gradilista', p_record_id: 'site', p_before_sequence: '9007199254740993' }],
    ['restore_resource_change', { p_history_id: 'event' }],
  ]);
  for (const code of ['22023', 'PGRST202']) {
    await assert.rejects(apiSetup({ error: { code } }).api.fetchResourceChangeHistory('gradilista', 'site'), /20261109233000/);
  }
  const denied = { code: '42501', message: 'Denied' };
  await assert.rejects(apiSetup({ error: denied }).api.fetchResourceChangeHistory('gradilista', 'site'), (reason) => reason === denied);
});

test('site history uses Croatian differences, permission checks and the shared restore lock', async () => {
  const selected = {
    ...change, operation: 'UPDATE', blocked_reason: null,
    before_data: { naziv: 'Staro', status: 'planirano', datum_pocetka: null, regija: 'dalmacija' },
    after_data: { naziv: 'Novo', status: 'aktivno', datum_pocetka: '2026-11-04', regija: 'medimurje' },
  };
  const ui = historyUI({ selected, resourceTable: 'gradilista' });
  ui.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ui.calls, [['resource-restore', 'history'], ['resource-fetch', 'gradilista', 'vehicle', undefined], 'refresh-parent']);
  assert.match(ui.messages[0], /Naziv: Novo → Staro/);
  assert.match(ui.messages[0], /Status: Aktivno → Planirano/);
  assert.match(ui.messages[0], /Datum početka: 04\.11\.2026\. → —/);
  assert.match(ui.messages[0], /Regija: Međimurje → Dalmacija/);
  assert.deepEqual(ui.activity, [true, false]);
  const denied = historyUI({ canEdit: false });
  assert.equal(denied.panel({ table: 'gradilista', recordId: 'site', module: 'gradilista', onRestore() {} }), null);
  assert.deepEqual(denied.permissions, [['gradilista', 'edit']]);
});

test('site editor wires history to the site, locks saving and discards stale state after restore', async () => {
  for (const state of ['ready', 'restoring', 'reload-error', 'deadline-error']) {
    const restoring = state === 'restoring';
    const calls = [];
    const states = [];
    const site = { id: 'site', naziv: 'Test', status: 'aktivno' };
    const HistoryPanel = () => null;
    const DeletionPanel = () => null;
    const WorkHistory = () => null;
    const scope = { start: () => () => true, invalidate() {} };
    const component = load('../src/components/views/GradilistaView.tsx', {
      react: {
        useState: (value) => [typeof value === 'function' ? value() : value, (next) => states.push(next)],
        useEffect() {}, useRef: (current) => ({ current }), useCallback: (fn) => fn,
      },
      'react/jsx-runtime': jsxRuntime,
      'lucide-react': { Building2() {}, Plus() {}, Pencil() {}, Trash2() {}, Calendar() {}, GripVertical() {}, AlertTriangle() {} },
      '@/lib/localization': localization,
      '@/lib/useRequestScope': { useRequestScope: () => scope },
      '@/lib/api': {
        fetchRokovi: async () => { if (state === 'deadline-error') throw new Error('Rokovi nisu dostupni'); return []; },
        fetchGradilista: async () => { calls.push('fetch-sites'); if (state === 'reload-error') throw new Error('Gradilišta nisu dostupna'); return [site]; },
        fetchInvestitori: async () => [],
        fetchGradilisteBoardLayout: async () => ({ columns: [['site'], [], []], sortModes: ['manual', 'manual', 'manual'] }),
        updateGradiliste: async () => { calls.push('save-site'); return site; },
      },
      '@/components/ui/Modal': { Modal() {} },
      '@/components/ui/ExportMenu': { ExportMenu() {} },
      '@/components/ui/Field': { Field() {}, TextInput() {}, Select() {}, Textarea() {} },
      '@/components/ui/ConfirmDialog': { ConfirmDialog() {} },
      '@/components/ui/EmptyState': { EmptyState() {} },
      '@/components/views/GradilisteDetailsPanel': { GradilisteDetailsPanel() {} },
      '@/components/views/FuelChangeHistory': { ResourceChangeHistoryPanel: HistoryPanel },
      '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory: DeletionPanel },
      '@/components/views/ContractedWorkHistory': { ContractedWorkHistory: WorkHistory, TaskHistory: WorkHistory },
      '@/lib/rokovi': { nextDeadline: () => null, deadlineAlert: () => null },
      '@/auth/useAuth': { useAuth: () => ({ canAccess: () => true }) },
      '@/lib/company': { DEFAULT_GRADILISTE_COLUMN_LABELS: ['A', 'B', 'C'] },
    }, {
      items: [site], loading: false, editing: site, modalOpen: true,
      targetColumn: '0', historyRestoring: restoring,
      form: { naziv: 'Test', investitorNaziv: '', objektNaziv: '', adresa: '', opis: '', status: 'aktivno' },
    });
    const tree = component.GradilistaView();
    const elements = nodes(tree);
    elements.push(...elements.filter((node) => node.props.footer).flatMap((node) => nodes(node.props.footer)));
    const history = elements.find((node) => node.type === HistoryPanel);
    const deletionHistory = elements.find((node) => node.type === DeletionPanel);
    const taskHistory = elements.find((node) => node.type === DeletionPanel && node.props.table === 'gradiliste_zadaci');
    const deadlineHistory = elements.find((node) => node.type === DeletionPanel && node.props.table === 'rokovi');
    const workHistory = elements.find((node) => node.type === DeletionPanel && node.props.table === 'ugovoreni_radovi');
    const workUpdates = elements.find((node) => node.type === WorkHistory);
    assert.equal(workUpdates.props.onRestore, workHistory.props.onRestore);
    assert.equal(workUpdates.props.onRestoringChange, workHistory.props.onRestoringChange);
    assert.equal(workUpdates.props.disabled, true);
    assert.equal(elements.filter((node) => node.type === WorkHistory).length, 2, 'Both task and contracted-work recovery share the global lock');
    for (const panel of [deletionHistory, taskHistory, deadlineHistory]) {
      assert.equal(panel.props.disabled, true, 'Close site editors before any competing bundle restore');
      assert.equal(panel.props.onRestoringChange, workUpdates.props.onRestoringChange);
    }
    assert.equal(workHistory.props.module, 'gradilista');
    assert.equal(workHistory.props.onRestore, deletionHistory.props.onRestore);
    assert.equal(workHistory.props.disabled, true, 'Close existing editors before starting work recovery');
    assert.equal(typeof workHistory.props.onRestoringChange, 'function');
    assert.equal(deadlineHistory.props.onRestore, deletionHistory.props.onRestore, 'Deadline restore discards stale site drafts');
    assert.equal(taskHistory.props.module, 'gradilista');
    assert.equal(taskHistory.props.onRestore, deletionHistory.props.onRestore, 'Task restore also closes and discards the site editor');
    assert.equal(deletionHistory.props.module, 'gradilista');
    assert.equal(deletionHistory.props.refreshVersion, 0);
    assert.equal(history.props.table, 'gradilista');
    assert.equal(history.props.recordId, 'site');
    assert.equal(history.props.module, 'gradilista');
    const save = elements.find((node) => node.type === 'button' && node.props.children === 'Spremi');
    assert.equal(save.props.disabled, restoring);
    assert.equal(elements.find((node) => node.type === 'fieldset').props.disabled, restoring);
    if (restoring) {
      await save.props.onClick();
      assert.deepEqual(calls, []);
    } else if (state.endsWith('error')) {
      await assert.rejects(workHistory.props.onRestore(), state === 'reload-error' ? /Gradilišta nisu dostupna/ : /Rokovi nisu dostupni/);
      assert.ok(!states.includes(true), 'Strict refresh must not unmount the restoring panel');
      assert.ok(states.some((value) => value?.naziv === ''), 'Clears drafts before strict refresh');
    } else {
      await history.props.onRestore();
      assert.ok(states.includes(false), 'Closes the editor');
      assert.ok(states.includes(null), 'Clears editing and selected details');
      assert.ok(states.some((value) => value?.naziv === ''), 'Clears the draft');
      assert.deepEqual(calls, ['fetch-sites']);
      await deletionHistory.props.onRestore();
      assert.deepEqual(calls, ['fetch-sites', 'fetch-sites']);
    }
  }
});

test('document delete and insert snapshots render without null errors and restore only their history ID', async () => {
  for (const operation of ['INSERT', 'DELETE']) {
    const snapshot = { naziv: 'Atest', putanja: 'oprema/tool/atest.pdf', datum_do: '2027-01-02' };
    const selected = { ...change, operation, blocked_reason: null,
      before_data: operation === 'DELETE' ? snapshot : null, after_data: operation === 'INSERT' ? snapshot : null };
    const ui = historyUI({ selected, documentTable: 'oprema_dokumenti' });
    ui.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(ui.calls, [['document-restore', 'history'], ['document-fetch', 'oprema_dokumenti', 'vehicle', undefined], 'refresh-parent']);
    assert.match(ui.messages[0], /Atest/);
    assert.match(ui.messages[0], /02\.01\.2027/);
    assert.match(ui.messages[0], /Obrazac dokumenta bit će resetiran/);
    const cancelled = historyUI({ selected, documentTable: 'oprema_dokumenti', confirmation: false });
    cancelled.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(cancelled.calls, []);
  }
});

test('document history requires edit permissions and retains the refresh counter', () => {
  const denied = historyUI({ canEdit: false });
  assert.equal(denied.documentPanel({ table: 'radnici_dokumenti', parentId: 'worker', module: 'radnici', refreshVersion: 3, onRestore() {} }), null);
  assert.deepEqual(denied.permissions, [['radnici', 'edit']]);
  const allowed = historyUI();
  const panel = allowed.documentPanel({ table: 'vozila_dokumenti', parentId: 'vehicle', module: 'vozila', refreshVersion: 7, onRestore() {} });
  assert.equal(panel.props.documentTable, 'vozila_dokumenti');
  assert.equal(panel.props.refreshVersion, 7);
});

test('deleting resource documents never removes retained Storage bytes and reports failed row deletes', async () => {
  for (const method of ['deleteRadnikDokument', 'deleteVoziloDokument', 'deleteOpremaDokument']) {
    const calls = [];
    let error = null;
    const api = load('../src/lib/api.ts', {
      './supabase': { supabase: {
        from: (table) => ({ delete: () => ({ eq: (_, id) => ({ select: () => ({
          single: async () => { calls.push([table, id]); return { error }; },
        }) }) }) }),
        storage: { from: () => { assert.fail('Retained document must not be deleted from Storage'); } },
      } },
      './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
      './pagination': {}, './rokovi': {}, './imageCompression': {},
    });
    await api[method]({ id: 'document', putanja: 'original.pdf' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1], 'document');
    error = { message: 'Document is not editable', code: 'PGRST116' };
    await assert.rejects(api[method]({ id: 'document', putanja: 'original.pdf' }), (reason) => reason === error);
  }
});

test('replacing a vehicle attachment retains the old file and cleans up only an uncommitted upload on failure', async () => {
  const removed = [];
  let result = { error: null };
  let uploadedPath;
  let saved;
  const api = load('../src/lib/api.ts', {
    './supabase': { supabase: {
      from: () => ({ update: (input) => {
        saved = input;
        const query = { eq: () => query, select: () => query, single: async () => result };
        return query;
      } }),
      storage: { from: () => ({
        upload: async (path) => { uploadedPath = path; return { error: null }; },
        remove: async (paths) => { removed.push(...paths); return { error: null }; },
      }) },
    } },
    './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
    './pagination': {}, './rokovi': {}, './imageCompression': {},
  });
  const document = { id: 'doc', vozilo_id: 'vehicle', putanja: 'original.pdf' };
  await api.updateVoziloDokument(document, { naziv: 'New document' }, { name: 'new.pdf', type: 'application/pdf' });
  assert.equal(saved.putanja, uploadedPath);
  assert.deepEqual(removed, []);
  result = { error: { message: 'No editable row', code: 'PGRST116' } };
  await assert.rejects(api.updateVoziloDokument(document, { naziv: 'Not saved' }, { name: 'failed.pdf' }), (reason) => reason === result.error);
  assert.deepEqual(removed, [uploadedPath]);
  assert.ok(!removed.includes(document.putanja));
});

test('document panels reset unsaved forms and reload real records after restoration', async () => {
  for (const worker of [true, false]) {
    const states = [];
    const fetches = [];
    const fileRef = { current: { value: 'draft.pdf' } };
    const component = load(worker ? '../src/components/views/RadnikDokumenti.tsx' : '../src/components/views/VoziloDokumenti.tsx', {
      react: { useState: (value) => [value, (next) => states.push(next)], useEffect() {}, useRef: () => fileRef, useCallback: (fn) => fn },
      'react/jsx-runtime': jsxRuntime,
      'lucide-react': { FileText() {}, Plus() {}, Trash2() {}, Paperclip() {}, Wrench() {}, Pencil() {}, X() {} },
      '@/lib/localization': localization,
      '@/lib/rokovi': { todayISO: () => '2026-11-04' },
      '@/lib/radnikDokumenti': { osnovneDokumentKategorije: [], dokumentVrste: {} },
      '@/auth/useAuth': { useAuth: () => ({ canAccess: () => true }) },
      '@/components/ui/Field': { TextInput() {}, Select() {}, Textarea() {} },
      '@/components/views/FuelChangeHistory': { DocumentChangeHistoryPanel() {} },
      '@/lib/useRequestScope': { useRequestScope: () => ({ start: () => () => true, invalidate() {} }) },
      '@/lib/api': {
        fetchRadnikDokumenti: async (id) => { fetches.push(id); return []; },
        fetchVoziloDokumenti: async (id) => { fetches.push(id); return []; },
      },
    });

    const tree = worker
      ? component.RadnikDokumenti({ radnikId: 'worker', onChange: () => fetches.push('parent') })
      : component.VoziloDokumenti({ voziloId: 'vehicle', onChange: () => fetches.push('parent') });
    const panel = nodes(tree).find((node) => node.props.table?.endsWith('_dokumenti'));
    assert.ok(panel);
    await panel.props.onRestore();
    assert.deepEqual(fetches, [worker ? 'worker' : 'vehicle', 'parent']);
    assert.equal(fileRef.current.value, '');
    assert.ok(states.includes(null));
    assert.ok(states.some((value) => value?.datum_od === '' && value?.datum_do === ''));
  }
});

test('all resource delete APIs use the protected transaction RPC and never fall back to direct deletes', async () => {
  const { api, calls } = apiSetup({ error: null });
  await api.deleteRadnik('worker');
  await api.deleteVozilo('vehicle');
  await api.deleteOprema('tool');
  await api.deleteGradiliste('site');
  await api.deleteRadniNalog('order');
  await api.discardRasporedNalog('draft');
  await api.fetchResourceDeletions('radnici', { id: 'cursor', created_at: '2026-11-04T10:00:00Z' });
  await api.restoreResourceDeletion('deletion');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['delete_resource_with_history', { p_table: 'radnici', p_record_id: 'worker' }],
    ['delete_resource_with_history', { p_table: 'vozila', p_record_id: 'vehicle' }],
    ['delete_resource_with_history', { p_table: 'oprema', p_record_id: 'tool' }],
    ['delete_resource_with_history', { p_table: 'gradilista', p_record_id: 'site' }],
    ['delete_resource_with_history', { p_table: 'radni_nalozi', p_record_id: 'order' }],
    ['delete_resource_with_history', { p_table: 'radni_nalozi', p_record_id: 'draft' }],
    ['get_resource_deletions', { p_module: 'radnici', p_before_time: '2026-11-04T10:00:00Z', p_before_id: 'cursor' }],
    ['restore_resource_deletion', { p_deletion_id: 'deletion' }],
  ]);
  const denied = { code: '42501', message: 'Denied' };
  await assert.rejects(apiSetup({ error: denied }).api.deleteRadnik('worker'), (reason) => reason === denied);
  await assert.rejects(apiSetup({ error: { code: 'PGRST202' } }).api.deleteVozilo('vehicle'), /20261109230000/);
  for (const code of ['22023', 'PGRST202']) {
    await assert.rejects(apiSetup({ error: { code } }).api.deleteGradiliste('site'), /20261109235000/);
    await assert.rejects(apiSetup({ error: { code } }).api.deleteRadniNalog('order'), /20261110000000/);
    await assert.rejects(apiSetup({ error: { code } }).api.discardRasporedNalog('draft'), /20261110000000/);
  }
  await assert.rejects(apiSetup({ error: denied }).api.deleteGradiliste('site'), (reason) => reason === denied);
  await assert.rejects(apiSetup({ error: denied }).api.deleteRadniNalog('order'), (reason) => reason === denied);
  await assert.rejects(apiSetup({ error: denied }).api.discardRasporedNalog('draft'), (reason) => reason === denied);
});

function deletionUI({ confirm = true, canEdit = true, restoreError, onRefreshError, selected, module = 'radnici', table, disabled = false, workerNames } = {}) {
  const calls = [];
  const permissions = [];
  const messages = [];
  const states = [];
  const activity = [];
  const row = selected ?? {
    id: 'deletion', snapshot: { ime: 'Marko', prezime: 'Test' }, actor_name: 'Admin',
    created_at: '2026-11-04T10:00:00Z', expires_at: '2026-12-04T10:00:00Z',
    reversed_at: null, can_restore: true, affected_rows: { radnici: 1, radno_vrijeme: 3, app_profiles: 1 },
  };
  const component = load('../src/components/views/ResourceDeletionHistory.tsx', {
    react: { useState: (value) => [value, (next) => states.push(next)], useEffect() {}, useCallback: (fn) => fn },
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': { RotateCcw() {} },
    './HistoryDialog': historyDialogMock,
    '@/lib/localization': localization,
    '@/auth/useAuth': { useAuth: () => ({ canAccess: (...args) => { permissions.push(args); return canEdit; } }) },
    '@/lib/useRequestScope': { useRequestScope: () => ({ start: () => () => true, invalidate() {} }) },
    '@/lib/api': {
      fetchResourceDeletions: async (...args) => { calls.push(['fetch', ...args]); return []; },
      fetchTaskDeletions: async (...args) => { calls.push(['fetch-tasks', ...args]); return []; },
      fetchDeadlineDeletions: async (...args) => { calls.push(['fetch-deadlines', ...args]); return []; },
      fetchAbsenceDeletions: async (...args) => { calls.push(['fetch-absences', ...args]); return []; },
      fetchContractedWorkDeletions: async (...args) => { calls.push(['fetch-works', ...args]); return []; },
      fetchKooperantInvoiceDeletions: async (...args) => { calls.push(['fetch-invoices', ...args]); return []; },
      restoreResourceDeletion: async (id) => { calls.push(['restore', id]); if (restoreError) throw restoreError; },
      restoreKooperantInvoiceDeletion: async (id) => { calls.push(['restore-invoice', id]); if (restoreError) throw restoreError; },
    },
  }, { open: true, items: [row] }, { window: { confirm: (message) => { messages.push(message); return confirm; } } });
  const panel = component.ResourceDeletionHistory({
    module, table, refreshVersion: 0, disabled, workerNames, onRestoringChange: (value) => activity.push(value),
    onRestore: async () => { calls.push('refresh-parent'); if (onRefreshError) throw onRefreshError; },
  });
  return { elements: panel ? nodes(panel.type(panel.props)) : [], calls, messages, states, permissions, activity };
}

function bundleRestoreButton(elements) {
  return elements.find((node) => node.type === 'button' && [].concat(node.props.children)
    .some((child) => typeof child === 'string' && child.trim() === 'Vrati resurs i povezane podatke'));
}

test('deleted-resource panel previews the complete bundle and restores only the deletion ID', async () => {
  const ui = deletionUI();
  bundleRestoreButton(ui.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ui.calls, [['restore', 'deletion'], ['fetch', 'radnici', undefined], 'refresh-parent']);
  assert.match(ui.messages[0], /Marko Test/);
  assert.match(ui.messages[0], /Radno vrijeme: 3/);
  assert.match(ui.messages[0], /Povezanost korisničkog računa: 1/);
  assert.match(ui.messages[0], /povrat se odbija u cijelosti/);
});

test('cancelled, unauthorized and conflicting bundle restores never refresh or report success', async () => {
  assert.equal(deletionUI({ canEdit: false }).elements.length, 0);
  const cancelled = deletionUI({ confirm: false });
  bundleRestoreButton(cancelled.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cancelled.calls, []);
  const failed = deletionUI({ restoreError: { message: 'Linked row changed' } });
  bundleRestoreButton(failed.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failed.calls, [['restore', 'deletion']]);
  assert.ok(failed.states.includes('Linked row changed'));
  assert.ok(!failed.states.includes('Resurs i povezani podaci su vraćeni.'));
});

test('a successful deletion restore distinguishes subsequent refresh errors from a failed restore', async () => {
  const ui = deletionUI({ onRefreshError: new Error('Refresh failed') });
  bundleRestoreButton(ui.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(ui.states.includes('Resurs i povezani podaci su vraćeni.'));
  assert.ok(ui.states.includes('Podaci su vraćeni, ali prikaz nije osvježen: Refresh failed'));
});

test('cooperator invoice deletion history previews the package, retains bytes and restores the group only', async () => {
  const selected={
    id:'invoice-deletion',snapshot:{id:'invoice',vrsta:'racun',naziv:'Račun R-101.pdf',putanja:'retained/invoice.pdf'},
    actor_name:'Admin',created_at:'2026-11-04T10:00:00Z',expires_at:'2026-12-04T10:00:00Z',
    reversed_at:null,can_restore:true,affected_rows:{kooperant_dokumenti:1,troskovi:2},
  };
  const ui=deletionUI({module:'kooperanti',table:'kooperant_racuni',selected});
  const button=ui.elements.find(node=>node.type==='button'&&[].concat(node.props.children)
    .some(child=>typeof child==='string'&&child.includes('Vrati račun, troškove i prilog')));
  assert.ok(button);
  button.props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ui.calls,[['restore-invoice','invoice-deletion'],['fetch-invoices',undefined],'refresh-parent']);
  assert.deepEqual(ui.permissions,[['kooperanti','edit']]);
  assert.match(ui.messages[0],/Račun · Račun R-101\.pdf/);
  assert.match(ui.messages[0],/Prilog kooperantskog računa: 1/);
  assert.match(ui.messages[0],/Izvorna datoteka ostaje sačuvana/);
  assert.ok(ui.states.includes('Račun, stavke troška i prilog su vraćeni.'));
  assert.deepEqual(ui.activity,[true,false]);
  const blocked=deletionUI({module:'kooperanti',table:'kooperant_racuni',selected:{...selected,can_restore:false}});
  const blockedButton=blocked.elements.find(node=>node.type==='button'&&[].concat(node.props.children)
    .some(child=>typeof child==='string'&&child.includes('Vrati račun, troškove i prilog')));
  assert.equal(blockedButton.props.disabled,true);
});

test('work-time deletion and history use protected RPCs and surface missing migrations and real errors', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.deleteRadnoVrijeme('hours');
  await api.replaceWorkOrderSettlement('order', [], []);
  await api.fetchResourceDeletions('radno_vrijeme');
  await api.fetchResourceDeletions('radno_vrijeme', { id: 'cursor', created_at: '2026-11-09T08:00:00Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['delete_work_time_with_history', { p_record_id: 'hours' }],
    ['replace_work_order_settlement', { p_nalog_id: 'order', p_entries: [], p_costs: [] }],
    ['get_work_time_deletions', { p_before_time: null, p_before_id: null }],
    ['get_work_time_deletions', { p_before_time: '2026-11-09T08:00:00Z', p_before_id: 'cursor' }],
  ]);
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const missing = apiSetup({ error: { code } }).api;
    await assert.rejects(missing.deleteRadnoVrijeme('hours'), /20261110040000/);
    await assert.rejects(missing.fetchResourceDeletions('radno_vrijeme'), /20261110040000/);
    await assert.rejects(missing.replaceWorkOrderSettlement('order', [], []), /20261110230000/);
  }
  for (const code of ['42501', '40001', 'P0001']) {
    const error = { code, message: 'Rejected' };
    const denied = apiSetup({ error }).api;
    await assert.rejects(denied.deleteRadnoVrijeme('hours'), (reason) => reason === error);
    await assert.rejects(denied.fetchResourceDeletions('radno_vrijeme'), (reason) => reason === error);
    await assert.rejects(denied.replaceWorkOrderSettlement('order', [], []), (reason) => reason === error);
  }
});

test('work-time update history preserves bigint cursors, accepts only the event ID for undo and surfaces errors', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.fetchWorkTimeChangeHistory('hours');
  await api.fetchWorkTimeChangeHistory('hours', '9007199254740993');
  await api.restoreWorkTimeChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_work_time_change_history', { p_record_id: 'hours', p_before_sequence: null }],
    ['get_work_time_change_history', { p_record_id: 'hours', p_before_sequence: '9007199254740993' }],
    ['restore_work_time_change', { p_history_id: 'event' }],
  ]);
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const missing = apiSetup({ error: { code } }).api;
    await assert.rejects(missing.fetchWorkTimeChangeHistory('hours'), /20261110050000/);
    await assert.rejects(missing.restoreWorkTimeChange('event'), /20261110050000/);
  }
  for (const code of ['42501', '40001', 'P0001', '23503']) {
    const error = { code, message: 'Rejected' };
    const denied = apiSetup({ error }).api;
    await assert.rejects(denied.fetchWorkTimeChangeHistory('hours'), (reason) => reason === error);
    await assert.rejects(denied.restoreWorkTimeChange('event'), (reason) => reason === error);
  }
});

test('manual hours history renders Croatian differences, routes undo and enforces module permissions and busy guards', async () => {
  const selected = {
    ...change, operation: 'UPDATE', blocked_reason: null,
    before_data: { sati: 7.5, nocni_sati: 2.5, datum: '2026-11-09', radnik_id: 'worker', gradiliste_id: null, napomena: 'Izvorno' },
    after_data: { sati: 9, nocni_sati: 0, datum: '2026-11-10', radnik_id: 'other', gradiliste_id: 'site', napomena: 'Novo' },
  };
  const ui = historyUI({ selected, workTimeHistory: true });
  const restoreButton = (elements) => elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu'));
  restoreButton(ui.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ui.calls, [['hours-restore', 'history'], ['hours-fetch', 'vehicle', undefined], 'refresh-parent']);
  assert.deepEqual(ui.activity, [true, false]);
  assert.match(ui.messages[0], /Ukupni sati: 9 → 7,5/);
  assert.match(ui.messages[0], /Noćni sati: 0 → 2,5/);
  assert.match(ui.messages[0], /Datum: 10\.11\.2026\. → 09\.11\.2026\./);
  assert.match(ui.messages[0], /Dodjela djelatniku: other → worker/);
  assert.match(ui.messages[0], /nespremljene izmjene neće se sačuvati/);
  const denied = historyUI({ canEdit: false });
  assert.equal(denied.workTimePanel({ recordId: 'hours', onRestore() {} }), null);
  assert.deepEqual(denied.permissions, [['radno_vrijeme', 'edit']]);
  const allowed = historyUI();
  const panel = allowed.workTimePanel({ recordId: 'hours', refreshVersion: 4, disabled: true, onRestore() {} });
  assert.equal(panel.props.workTimeHistory, true);
  assert.equal(panel.props.vehicleId, 'hours');
  assert.equal(panel.props.refreshVersion, 4);
  assert.equal(panel.props.disabled, true);
  for (const options of [{ disabled: true }, { confirmation: false }, { selected: { ...selected, can_restore: false, blocked_reason: 'Sate održava povezani radni nalog.' } }]) {
    const blocked = historyUI({ selected, workTimeHistory: true, ...options });
    restoreButton(blocked.elements).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(blocked.calls, []);
  }
  const failed = historyUI({ selected, workTimeHistory: true, error: { message: 'Novija promjena sati' } });
  restoreButton(failed.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failed.calls, [['hours-restore', 'history']]);
  assert.deepEqual(failed.activity, [true, false]);
  assert.ok(failed.states.includes('Novija promjena sati'));
});

test('absence deletion uses protected RPCs, lossless pagination and explicit migration/permission errors', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.deleteOdsustvo('absence');
  await api.fetchAbsenceDeletions();
  await api.fetchAbsenceDeletions({ id: 'cursor', created_at: '2026-11-09T08:00:00Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['delete_absence_with_history', { p_record_id: 'absence' }],
    ['get_absence_deletions', { p_before_time: null, p_before_id: null }],
    ['get_absence_deletions', { p_before_time: '2026-11-09T08:00:00Z', p_before_id: 'cursor' }],
  ]);
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const missing = apiSetup({ error: { code } }).api;
    await assert.rejects(missing.deleteOdsustvo('absence'), /20261110060000/);
    await assert.rejects(missing.fetchAbsenceDeletions(), /20261110060000/);
  }
  for (const code of ['42501', '40001', 'P0001']) {
    const error = { code, message: 'Rejected' };
    const denied = apiSetup({ error }).api;
    await assert.rejects(denied.deleteOdsustvo('absence'), (reason) => reason === error);
    await assert.rejects(denied.fetchAbsenceDeletions(), (reason) => reason === error);
  }
});

test('absence recovery previews worker, type and full period and uses worker permissions rather than site permissions', async () => {
  for (const [kind, label] of [['godisnji', 'Godišnji odmor'], ['bolovanje', 'Bolovanje'], ['praznik', 'Praznik']]) {
    const selected = {
      id: 'absence', snapshot: { radnik_id: 'worker', vrsta: kind, datum_od: '2026-11-09', datum_do: '2026-11-13', napomena: 'Izvorno' },
      actor_name: 'Ured', created_at: '2026-11-04T08:00:00Z', expires_at: '2026-12-04T08:00:00Z',
      reversed_at: null, can_restore: true, affected_rows: { radnici_odsustva: 1 },
    };
    const ui = deletionUI({ selected, module: 'radnici', table: 'radnici_odsustva', workerNames: { worker: 'Ana Test' } });
    bundleRestoreButton(ui.elements).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(ui.calls, [['restore', 'absence'], ['fetch-absences', undefined], 'refresh-parent']);
    assert.deepEqual(ui.permissions, [['radnici', 'edit']]);
    assert.deepEqual(ui.activity, [true, false]);
    assert.match(ui.messages[0], /obrisano odsustvo/);
    assert.ok(ui.messages[0].includes(`Ana Test · ${label} · 09.11.2026. – 13.11.2026.`));
    const blocked = deletionUI({ selected: { ...selected, can_restore: false }, table: 'radnici_odsustva' });
    assert.equal(bundleRestoreButton(blocked.elements).props.disabled, true);
    assert.ok(blocked.elements.some((node) => String(node.props.children).includes('odsustva djelatnika naknadno promijenjena')));
    const busy = deletionUI({ selected, table: 'radnici_odsustva', disabled: true });
    bundleRestoreButton(busy.elements).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(busy.calls, []);
  }
  const denied = deletionUI({ canEdit: false, table: 'radnici_odsustva' });
  assert.equal(denied.elements.length, 0);
  assert.deepEqual(denied.permissions, [['radnici', 'edit']]);
});

test('payroll absence recovery locks writes, resets stale dialogs, retains month and surfaces refresh failures', async () => {
  const obracun = load('../src/lib/obracunSati.ts', {});
  for (const state of ['ready', 'saving', 'rights-saving', 'restoring', 'reload-error', 'hours-error', 'readonly', 'delete-error']) {
    const calls = [];
    const states = [];
    let stateIndex = 0;
    const Panel = () => null;
    const Modal = () => null;
    const Confirm = () => null;
    const component = load('../src/components/views/ObracunSatiPanel.tsx', {
      react: {
        useState: (initial) => {
          const index = stateIndex++;
          const setter = (value) => { states.push([index, value]); };
          return [typeof initial === 'function' ? initial() : initial, setter];
        },
        useEffect() {}, useMemo: (fn) => fn(),
      },
      'react/jsx-runtime': jsxRuntime,
      'lucide-react': { ChevronLeft() {}, ChevronRight() {}, Plus() {}, Trash2() {}, Calculator() {} },
      '@/lib/localization': localization,
      '@/lib/obracunSati': obracun,
      '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory: Panel },
      '@/components/ui/Modal': { Modal },
      '@/components/ui/Field': { Field() {}, TextInput() {}, Select() {}, Textarea() {} },
      '@/components/ui/ConfirmDialog': { ConfirmDialog: Confirm },
      '@/lib/api': {
        fetchRadnici: async () => { calls.push('workers'); return []; },
        fetchObracunRadnoVrijeme: async (...args) => { calls.push(['hours', ...args]); if (state === 'hours-error') throw new Error('Hours unavailable'); return []; },
        fetchOdsustvaRaspon: async (...args) => { calls.push(['absences', ...args]); if (state === 'reload-error') throw new Error('Absences unavailable'); return []; },
        addOdsustvo: async () => calls.push('add'),
        deleteOdsustvo: async () => { calls.push('delete'); if (state === 'delete-error') throw { message: 'Naknadno promijenjeno odsustvo' }; },
        updateRadnik: async () => calls.push('rights'),
      },
    }, {
      mjesec: '2026-11', loading: false, savingOdsustvo: state === 'saving',
      savingPravo: state === 'rights-saving' ? 'worker:nocni' : null,
      historyRestoring: state === 'restoring', deleteOdsustvoId: 'absence', selectedRadnikId: 'worker',
      odsustvoForm: { radnik_id: 'worker', vrsta: 'godisnji', datum_od: '2026-11-09', datum_do: '2026-11-13', napomena: 'Nacrt' },
    });
    const elements = nodes(component.ObracunSatiPanel({ canEdit: state !== 'readonly' }));
    const history = elements.find((node) => node.type === Panel);
    if (state === 'readonly') {
      assert.equal(history, undefined);
      await elements.find((node) => node.type === Confirm).props.onConfirm();
      assert.deepEqual(calls, []);
      continue;
    }
    assert.equal(history.props.module, 'radnici');
    assert.equal(history.props.table, 'radnici_odsustva');
    assert.equal(history.props.disabled, state === 'saving' || state === 'rights-saving');
    const modal = elements.find((node) => node.type === Modal && node.props.title === 'Upiši odsustvo');
    const buttons = nodes(modal.props.footer);
    const save = buttons.find((node) => node.type === 'button' && node.props.children !== 'Odustani');
    if (['saving', 'rights-saving', 'restoring'].includes(state)) {
      assert.equal(save.props.disabled, true);
      assert.ok(elements.filter((node) => node.type === 'fieldset').every((node) => node.props.disabled));
      await save.props.onClick();
      await elements.find((node) => node.type === Confirm).props.onConfirm();
      modal.props.onClose();
      assert.deepEqual(calls, []);
      assert.deepEqual(states, []);
    } else if (state === 'delete-error') {
      await elements.find((node) => node.type === Confirm).props.onConfirm();
      assert.deepEqual(calls, ['delete']);
      assert.ok(states.some(([, value]) => value === 'Naknadno promijenjeno odsustvo'), 'Preserves the real Supabase error');
    } else {
      if (state === 'reload-error') await assert.rejects(history.props.onRestore(), /Absences unavailable/);
      else if (state === 'hours-error') await assert.rejects(history.props.onRestore(), /Hours unavailable/);
      else await history.props.onRestore();
      assert.deepEqual(states.slice(0, 3), [[8, null], [10, null], [11, null]], 'Clears the draft, deletion and worker detail dialogs');
      assert.ok(!states.some(([, value]) => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)), 'Keeps selected month');
      assert.deepEqual(calls, state === 'hours-error' ? ['workers', ['hours', '2026-11-01', '2026-11-30']]
        : ['workers', ['hours', '2026-11-01', '2026-11-30'], ['absences', '2026-11-01', '2026-11-30']]);
    }
  }
});

test('order header history RPC preserves scope and bigint cursors and surfaces migration and server errors', async () => {
  const {api,calls}=apiSetup({data:[],error:null});
  await api.fetchOrderChangeHistory('order');
  await api.fetchOrderChangeHistory('order','9007199254740993');
  await api.restoreOrderChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['get_order_change_history',{p_record_id:'order',p_before_sequence:null}],
    ['get_order_change_history',{p_record_id:'order',p_before_sequence:'9007199254740993'}],
    ['restore_order_change',{p_history_id:'event'}],
  ]);
  for(const code of ['42P01','42883','PGRST202','PGRST205']){
    const missing=apiSetup({error:{code}}).api;
    await assert.rejects(missing.fetchOrderChangeHistory('order'),/20261110150000/);
    await assert.rejects(missing.restoreOrderChange('event'),/20261110150000/);
  }
  for(const code of ['42501','40001','23503','P0001']){
    const error={code,message:'Rejected'};
    const denied=apiSetup({error}).api;
    await assert.rejects(denied.fetchOrderChangeHistory('order'),reason=>reason===error);
    await assert.rejects(denied.restoreOrderChange('event'),reason=>reason===error);
  }
});

test('order undo previews supported fields, enforces order edit rights and busy/conflict guards', async () => {
  const selected={...change,operation:'UPDATE',blocked_reason:null,
    before_data:{naslov:'Izvorni naslov',opis:'Izvorni opis',prioritet:'srednji',rok:'2026-11-09'},
    after_data:{naslov:'Novo',opis:null,prioritet:'hitno',rok:'2026-11-20'}};
  const button=ui=>ui.elements.find(node=>node.type==='button'&&node.props.children?.includes('Vrati promjenu'));
  const ui=historyUI({selected,orderHistory:true});
  button(ui).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ui.calls,[['order-restore','history'],['order-fetch','vehicle',undefined],'refresh-parent']);
  assert.deepEqual(ui.activity,[true,false]);
  assert.match(ui.messages[0],/Naslov: Novo → Izvorni naslov/);
  assert.match(ui.messages[0],/Opis: — → Izvorni opis/);
  assert.match(ui.messages[0],/Prioritet: Hitno → Srednji/);
  assert.match(ui.messages[0],/Rok:/);
  assert.match(ui.messages[0],/Povezani dokumenti, obračuni i drugi zapisi neće se vratiti/);
  const denied=historyUI({canEdit:false});
  assert.equal(denied.orderPanel({recordId:'order',onRestore(){}}),null);
  assert.deepEqual(denied.permissions,[['radni_nalozi','edit']]);
  const wrapper=historyUI().orderPanel({recordId:'order',onRestore(){},disabled:true});
  assert.equal(wrapper.props.orderHistory,true);
  assert.equal(wrapper.props.vehicleId,'order');
  assert.equal(wrapper.props.disabled,true);
  for(const options of [{disabled:true},{confirmation:false},{selected:{...selected,can_restore:false,blocked_reason:'Status zahtijeva zajednički povrat'}}]){
    const blocked=historyUI({selected,orderHistory:true,...options});
    button(blocked).props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(blocked.calls,[]);
  }
  const failed=historyUI({selected,orderHistory:true,error:{message:'Nalog ima noviju promjenu'}});
  button(failed).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(failed.calls,[['order-restore','history']]);
  assert.ok(failed.states.includes('Nalog ima noviju promjenu'));
  assert.deepEqual(failed.activity,[true,false]);
});

test('investor history RPC preserves bigint cursors and reports missing migrations and server errors', async () => {
  const {api,calls}=apiSetup({data:[],error:null});
  await api.fetchInvestorChangeHistory('investor');
  await api.fetchInvestorChangeHistory('investor','9007199254740993');
  await api.restoreInvestorChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['get_investor_change_history',{p_record_id:'investor',p_before_sequence:null}],
    ['get_investor_change_history',{p_record_id:'investor',p_before_sequence:'9007199254740993'}],
    ['restore_investor_change',{p_history_id:'event'}],
  ]);
  for(const code of ['42P01','42883','PGRST202','PGRST205']){
    const missing=apiSetup({error:{code}}).api;
    await assert.rejects(missing.fetchInvestorChangeHistory('investor'),/20261110160000/);
    await assert.rejects(missing.restoreInvestorChange('event'),/20261110160000/);
  }
  for(const code of ['42501','40001','23503','P0001']){
    const error={code,message:'Rejected'};
    const denied=apiSetup({error}).api;
    await assert.rejects(denied.fetchInvestorChangeHistory('investor'),reason=>reason===error);
    await assert.rejects(denied.restoreInvestorChange('event'),reason=>reason===error);
  }
});

test('investor undo previews registry fields, requires investor edit rights and blocks busy or conflicting actions', async () => {
  const selected={...change,operation:'UPDATE',blocked_reason:null,
    before_data:{naziv:'Izvorni investitor',oib:'00000000001',adresa:'Izvorna 1',mjesto:'Zagreb',
      postanski_broj:'10000',kontakt_osoba:'Ana',telefon:null,email:'ana@example.test',web:'https://example.test',napomena:'Izvorno'},
    after_data:{naziv:'Novi investitor',oib:'00000000002',adresa:null,mjesto:'Split',
      postanski_broj:'21000',kontakt_osoba:'Ivan',telefon:'099111',email:null,web:null,napomena:null}};
  const button=ui=>ui.elements.find(node=>node.type==='button'&&node.props.children?.includes('Vrati promjenu'));
  const ui=historyUI({selected,investorHistory:true});
  button(ui).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ui.calls,[['investor-restore','history'],['investor-fetch','vehicle',undefined],'refresh-parent']);
  assert.deepEqual(ui.activity,[true,false]);
  for(const line of ['Naziv: Novi investitor → Izvorni investitor','OIB: 00000000002 → 00000000001',
    'Adresa: — → Izvorna 1','Mjesto: Split → Zagreb','Poštanski broj: 21000 → 10000',
    'Kontakt osoba: Ivan → Ana','Telefon: 099111 → —','Web-stranica: — → https://example.test']){
    assert.ok(ui.messages[0].includes(line),line);
  }
  const denied=historyUI({canEdit:false});
  assert.equal(denied.investorPanel({recordId:'investor',onRestore(){}}),null);
  assert.deepEqual(denied.permissions,[['investitori','edit']]);
  const wrapper=historyUI().investorPanel({recordId:'investor',onRestore(){},disabled:true});
  assert.equal(wrapper.props.investorHistory,true);
  assert.equal(wrapper.props.vehicleId,'investor');
  assert.equal(wrapper.props.disabled,true);
  for(const options of [{disabled:true},{confirmation:false},{selected:{...selected,can_restore:false,blocked_reason:'Novija promjena'}}]){
    const blocked=historyUI({selected,investorHistory:true,...options});
    button(blocked).props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(blocked.calls,[]);
  }
  const failed=historyUI({selected,investorHistory:true,error:{message:'Investitor ima noviju promjenu'}});
  button(failed).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(failed.calls,[['investor-restore','history']]);
  assert.ok(failed.states.includes('Investitor ima noviju promjenu'));
  assert.deepEqual(failed.activity,[true,false]);
});

test('investor view keeps independent history selection, locks writes and performs strict refresh without unmounting history', async () => {
  for(const state of ['ready','denied','saving','modal','restoring','contact-saving','overview','delete','reload-error']) {
    const states=[];
    const calls=[];
    const Panel=()=>null;
    const investor={id:'investor',naziv:'Izvorni investitor',created_at:'2026-01-01'};
    const component=load('../src/components/views/RegistryViews.tsx',{
      react:{useState:(value)=>[value,next=>states.push(next)],useEffect(){},useCallback:fn=>fn},
      'react/jsx-runtime':jsxRuntime,
      'lucide-react':{ArrowDown(){},ArrowUp(){},ArrowUpDown(){},BookOpen(){},Building2(){},Pencil(){},Plus(){},RotateCcw(){},Search(){},Trash2(){},Users(){}},
      '@/auth/useAuth':{useAuth:()=>({canAccess:(...args)=>{assert.deepEqual(args,['investitori','edit']);return state!=='denied';}})},
      '@/lib/useRequestScope':{useRequestScope:()=>({start:()=>()=>true,invalidate(){calls.push('invalidate');}})},
      '@/lib/localization':localization,
      '@/lib/api':{
        iznosFakture:invoice=>invoice.iznos,
        fetchInvestitori:async()=>{calls.push('investors');if(state==='reload-error')throw {message:'Investitori nisu dostupni'};return [investor];},
        fetchAllObjekti:async()=>{calls.push('objects');return [];},
        fetchGradilista:async()=>{calls.push('sites');return [];},
        fetchTroskovi:async()=>{calls.push('costs');return [];},
        fetchRadnoVrijeme:async()=>{calls.push('hours');return [];},
        fetchFakture:async()=>{calls.push('invoices');return [];},
        fetchRadniNalozi:async()=>{calls.push('orders');return [];},
      },
      '@/components/ui/EmptyState':{EmptyState(){}},
      '@/components/ui/ConfirmDialog':{ConfirmDialog(){}},
      '@/components/ui/Field':{Field(){},Select(){},TextInput(){},Textarea(){}},
      '@/components/ui/Modal':{Modal(){}},
      '@/components/ui/ExportMenu':{ExportMenu(){}},
      '@/components/views/FuelChangeHistory':{InvestorChangeHistoryPanel:Panel},
    },{loading:false,investitori:[investor],historyInvestorId:'investor',query:'Will hide investor',year:'2025',
      saving:state==='saving',modalOpen:state==='modal',historyRestoring:state==='restoring',contactSaving:state==='contact-saving',
      selectedInvestor:state==='overview'?investor:null,deleteTarget:state==='delete'?investor:null});
    const tree=component.InvestitoriView();
    const elements=nodes(tree);
    const panel=elements.find(node=>node.type===Panel);
    if(state==='denied'){assert.equal(panel,undefined);continue;}
    const selector=elements.find(node=>node.type==='select'&&node.props['aria-label']==='Investitor za povijest izmjena');
    assert.equal(panel.props.recordId,'investor');
    assert.ok(nodes(selector).some(node=>node.type==='option'&&node.props.value==='investor'),'Selector ignores table filters');
    assert.equal(panel.props.disabled,['saving','modal','restoring','contact-saving','overview','delete'].includes(state));
    assert.equal(selector.props.disabled,panel.props.disabled);
    assert.ok(!nodes(elements.find(node=>node.type==='fieldset')).some(node=>node.type===Panel),'History stays outside disabled fieldset');
    if(state==='restoring')assert.ok(elements.find(node=>node.type==='fieldset').props.disabled);
    panel.props.onRestoringChange(true);
    if(state==='reload-error'){
      await assert.rejects(panel.props.onRestore(),reason=>reason.message==='Investitori nisu dostupni');
      assert.ok(states.includes('Investitori nisu dostupni'));
    }else{
      await panel.props.onRestore();
      assert.ok(states.includes(null));
      assert.ok(states.includes(''));
      assert.ok(states.some(value=>value?.naziv===''&&value?.oib===''),'Discard master-data draft');
      assert.ok(states.some(value=>value?.uloga===''&&value?.ime===''),'Discard separate contact draft');
    }
    assert.deepEqual(calls,['invalidate','investors','objects','sites','costs','hours','invoices','orders']);
    assert.equal(states.filter(value=>value===true).length,1,'Strict reload must not set page loading and unmount history');
  }
});

test('object history RPC preserves bigint cursors and reports missing migrations and server errors', async () => {
  const {api,calls}=apiSetup({data:[],error:null});
  await api.fetchObjectChangeHistory('object');
  await api.fetchObjectChangeHistory('object','9007199254740993');
  await api.restoreObjectChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['get_object_change_history',{p_record_id:'object',p_before_sequence:null}],
    ['get_object_change_history',{p_record_id:'object',p_before_sequence:'9007199254740993'}],
    ['restore_object_change',{p_history_id:'event'}],
  ]);
  for(const code of ['42P01','42883','PGRST202','PGRST205']){
    const missing=apiSetup({error:{code}}).api;
    await assert.rejects(missing.fetchObjectChangeHistory('object'),/20261110170000/);
    await assert.rejects(missing.restoreObjectChange('event'),/20261110170000/);
  }
  for(const code of ['42501','40001','23503','23505','P0001']){
    const error={code,message:'Rejected'};
    const denied=apiSetup({error}).api;
    await assert.rejects(denied.fetchObjectChangeHistory('object'),reason=>reason===error);
    await assert.rejects(denied.restoreObjectChange('event'),reason=>reason===error);
  }
});

test('object undo previews exact investor IDs and registry fields and requires object edit rights', async () => {
  const selected={...change,operation:'UPDATE',blocked_reason:null,
    before_data:{naziv:'Izvorni objekt',investitor_id:'investor-original',adresa:'Izvorna 1',mjesto:'Zagreb',
      postanski_broj:'10000',kontakt_osoba:'Ana',telefon:null,napomena:'Izvorno'},
    after_data:{naziv:'Novi objekt',investitor_id:'investor-new',adresa:null,mjesto:'Split',
      postanski_broj:'21000',kontakt_osoba:'Ivan',telefon:'099111',napomena:null}};
  const button=ui=>ui.elements.find(node=>node.type==='button'&&node.props.children?.includes('Vrati promjenu'));
  const ui=historyUI({selected,objectHistory:true});
  button(ui).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ui.calls,[['object-restore','history'],['object-fetch','vehicle',undefined],'refresh-parent']);
  assert.deepEqual(ui.activity,[true,false]);
  for(const line of ['Naziv: Novi objekt → Izvorni objekt','Investitor (ID): investor-new → investor-original',
    'Adresa: — → Izvorna 1','Mjesto: Split → Zagreb','Poštanski broj: 21000 → 10000',
    'Kontakt osoba: Ivan → Ana','Telefon: 099111 → —']){
    assert.ok(ui.messages[0].includes(line),line);
  }
  const denied=historyUI({canEdit:false});
  assert.equal(denied.objectPanel({recordId:'object',onRestore(){}}),null);
  assert.deepEqual(denied.permissions,[['objekti','edit']]);
  const wrapper=historyUI().objectPanel({recordId:'object',onRestore(){},disabled:true});
  assert.equal(wrapper.props.objectHistory,true);
  assert.equal(wrapper.props.vehicleId,'object');
  assert.equal(wrapper.props.disabled,true);
  for(const options of [{disabled:true},{confirmation:false},{selected:{...selected,can_restore:false,blocked_reason:'Nedostupan investitor'}}]){
    const blocked=historyUI({selected,objectHistory:true,...options});
    button(blocked).props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(blocked.calls,[]);
  }
  const failed=historyUI({selected,objectHistory:true,error:{message:'Objekt ima noviju promjenu'}});
  button(failed).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(failed.calls,[['object-restore','history']]);
  assert.ok(failed.states.includes('Objekt ima noviju promjenu'));
  assert.deepEqual(failed.activity,[true,false]);
});

test('object view keeps history outside write lock and search, blocks editors and knowledge writes and strictly refreshes', async () => {
  for(const state of ['ready','denied','saving','modal','restoring','knowledge-saving','overview','delete','reload-error']) {
    const states=[];
    const calls=[];
    const Panel=()=>null;
    const object={id:'object',naziv:'Izvorni objekt',investitor_id:'investor',
      znanje:[{id:'knowledge',kategorija:'Materijali',naslov:'Znanje',opis:'Opis'}]};
    const Dialog=()=>null;
    const component=load('../src/components/views/RegistryViews.tsx',{
      react:{useState:(value)=>[value,next=>states.push(next)],useEffect(){},useCallback:fn=>fn},
      'react/jsx-runtime':jsxRuntime,
      'lucide-react':{ArrowDown(){},ArrowUp(){},ArrowUpDown(){},BookOpen(){},Building2(){},Pencil(){},Plus(){},RotateCcw(){},Search(){},Trash2(){},Users(){}},
      '@/auth/useAuth':{useAuth:()=>({canAccess:(...args)=>{assert.deepEqual(args,['objekti','edit']);return state!=='denied';}})},
      '@/lib/useRequestScope':{useRequestScope:()=>({start:()=>()=>true,invalidate(){}})},
      '@/lib/localization':localization,
      '@/lib/api':{
        iznosFakture:invoice=>invoice.iznos,
        saveObjekt:async()=>{calls.push('write-object');return object;},
        deleteObjekt:async()=>{calls.push('delete-object');},
        saveObjektZnanje:async()=>{calls.push('write-knowledge');},
        fetchAllObjekti:async()=>{calls.push('objects');if(state==='reload-error')throw {message:'Objekti nisu dostupni'};return [object];},
        fetchGradilista:async()=>{calls.push('sites');return [];},
        fetchFakture:async()=>{calls.push('invoices');return [];},
        fetchInvestitori:async()=>{calls.push('investors');return [];},
        fetchTroskovi:async()=>{calls.push('costs');return [];},
        fetchRadnoVrijeme:async()=>{calls.push('hours');return [];},
        fetchRadniNalozi:async()=>{calls.push('orders');return [];},
      },
      '@/components/ui/EmptyState':{EmptyState(){}},
      '@/components/ui/ConfirmDialog':{ConfirmDialog:Dialog},
      '@/components/ui/Field':{Field(){},Select(){},TextInput(){},Textarea(){}},
      '@/components/ui/Modal':{Modal(){}},
      '@/components/ui/ExportMenu':{ExportMenu(){}},
      '@/components/views/FuelChangeHistory':{ObjectChangeHistoryPanel:Panel},
    },{loading:false,objekti:[object],historyObjectId:'object',query:'Will hide object',
      saving:state==='saving',modalOpen:state==='modal',historyRestoring:state==='restoring',znanjeSaving:state==='knowledge-saving',
      selectedObjekt:['overview','restoring'].includes(state)?object:null,deleteTarget:['delete','restoring'].includes(state)?object:null,
      form:{naziv:'Nacrt',investitor_id:'investor',adresa:'',mjesto:'',postanski_broj:'',kontakt_osoba:'',telefon:'',napomena:''},
      znanjeFormOpen:true,znanjeForm:{kategorija:'Materijali',naslov:'Nacrt znanja',opis:''}});
    const elements=nodes(component.ObjektiView());
    const panel=elements.find(node=>node.type===Panel);
    if(state==='denied'){assert.equal(panel,undefined);continue;}
    const selector=elements.find(node=>node.type==='select'&&node.props['aria-label']==='Objekt za povijest izmjena');
    assert.equal(panel.props.recordId,'object');
    assert.ok(nodes(selector).some(node=>node.type==='option'&&node.props.value==='object'),'Selector ignores table search');
    assert.equal(panel.props.disabled,['saving','modal','restoring','knowledge-saving','overview','delete'].includes(state));
    assert.equal(selector.props.disabled,panel.props.disabled);
    assert.ok(!nodes(elements.find(node=>node.type==='fieldset')).some(node=>node.type===Panel));
    if(state==='restoring'){
      assert.ok(elements.find(node=>node.type==='fieldset').props.disabled);
      elements.find(node=>node.type==='form'&&node.props.id==='objekt-form').props.onSubmit({preventDefault(){}});
      await elements.find(node=>node.type===Dialog).props.onConfirm();
      elements.find(node=>node.type==='button'&&node.props.children?.includes('Spremi podatak')).props.onClick();
      elements.find(node=>node.type==='button'&&node.props['aria-label']==='Obriši podatak Znanje').props.onClick();
      await new Promise(resolve=>setImmediate(resolve));
      assert.deepEqual(calls,[],'Object save, delete and both knowledge writes are blocked during recovery');
      assert.deepEqual(states,[]);
    }
    panel.props.onRestoringChange(true);
    if(state==='reload-error'){
      await assert.rejects(panel.props.onRestore(),reason=>reason.message==='Objekti nisu dostupni');
      assert.ok(states.includes('Objekti nisu dostupni'));
    }else{
      await panel.props.onRestore();
      assert.ok(states.includes(null));
      assert.ok(states.includes(''));
      assert.ok(states.some(value=>value?.naziv===''&&value?.investitor_id===''),'Discard object draft');
      assert.ok(states.some(value=>value?.kategorija==='Materijali'&&value?.naslov===''),'Discard knowledge draft');
    }
    assert.deepEqual(calls,['objects','sites','invoices','investors','costs','hours','orders']);
    assert.equal(states.filter(value=>value===true).length,1,'Strict reload must not set page loading and unmount history');
  }
});

test('cooperator history RPC preserves bigint cursors and reports missing migrations and server errors', async () => {
  const {api,calls}=apiSetup({data:[],error:null});
  await api.fetchCooperatorChangeHistory('cooperator');
  await api.fetchCooperatorChangeHistory('cooperator','9007199254740993');
  await api.restoreCooperatorChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['get_cooperator_change_history',{p_record_id:'cooperator',p_before_sequence:null}],
    ['get_cooperator_change_history',{p_record_id:'cooperator',p_before_sequence:'9007199254740993'}],
    ['restore_cooperator_change',{p_history_id:'event'}],
  ]);
  for(const code of ['42P01','42883','PGRST202','PGRST205']){
    const missing=apiSetup({error:{code}}).api;
    await assert.rejects(missing.fetchCooperatorChangeHistory('cooperator'),/20261110180000/);
    await assert.rejects(missing.restoreCooperatorChange('event'),/20261110180000/);
  }
  for(const code of ['42501','40001','23514','P0001']){
    const error={code,message:'Rejected'};
    const denied=apiSetup({error}).api;
    await assert.rejects(denied.fetchCooperatorChangeHistory('cooperator'),reason=>reason===error);
    await assert.rejects(denied.restoreCooperatorChange('event'),reason=>reason===error);
  }
});

test('cooperator undo previews IBAN activity and timeline color and enforces module edit rights', async () => {
  const selected={...change,operation:'UPDATE',blocked_reason:null,
    before_data:{naziv:'Izvorni kooperant',djelatnost:'Elektro',iban:'HR0000000000000000000',timeline_color:'#112233',telefon:null},
    after_data:{naziv:'Novi kooperant',djelatnost:null,iban:null,timeline_color:'#aabbcc',telefon:'099111'}};
  const button=ui=>ui.elements.find(node=>node.type==='button'&&node.props.children?.includes('Vrati promjenu'));
  const ui=historyUI({selected,cooperatorHistory:true});
  button(ui).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ui.calls,[['cooperator-restore','history'],['cooperator-fetch','vehicle',undefined],'refresh-parent']);
  assert.deepEqual(ui.activity,[true,false]);
  for(const line of ['Naziv: Novi kooperant → Izvorni kooperant','Djelatnost: — → Elektro',
    'IBAN: — → HR0000000000000000000','Boja terminskog plana: #aabbcc → #112233','Telefon: 099111 → —']){
    assert.ok(ui.messages[0].includes(line),line);
  }
  const denied=historyUI({canEdit:false});
  assert.equal(denied.cooperatorPanel({recordId:'cooperator',onRestore(){}}),null);
  assert.deepEqual(denied.permissions,[['kooperanti','edit']]);
  const wrapper=historyUI().cooperatorPanel({recordId:'cooperator',onRestore(){},disabled:true});
  assert.equal(wrapper.props.cooperatorHistory,true);
  assert.equal(wrapper.props.vehicleId,'cooperator');
  assert.equal(wrapper.props.disabled,true);
  for(const options of [{disabled:true},{confirmation:false},{selected:{...selected,can_restore:false,blocked_reason:'Novija promjena'}}]){
    const blocked=historyUI({selected,cooperatorHistory:true,...options});
    button(blocked).props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(blocked.calls,[]);
  }
  const failed=historyUI({selected,cooperatorHistory:true,error:{message:'Kooperant ima noviju promjenu'}});
  button(failed).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(failed.calls,[['cooperator-restore','history']]);
  assert.ok(failed.states.includes('Kooperant ima noviju promjenu'));
  assert.deepEqual(failed.activity,[true,false]);
});

test('cooperator view keeps history independent, locks all pending writes and strictly reloads without unmounting', async () => {
  const busy=['saving','savingEngagement','savingCost','uploading','deletingCost','deletingDocument','analyzingInvoice','savingInvoice','updatingOfferId','updatingCostId'];
  for(const state of ['ready','denied','modal','restoring','profile','delete','document-delete','cost-delete','reload-error','limited',...busy]) {
    const states=[];
    const calls=[];
    const Panel=()=>null;
    const EngagementPanel=()=>null;
    const DeletionPanel=()=>null;
    const Dialog=()=>null;
    const Modal=()=>null;
    const cooperator={id:'cooperator',naziv:'Izvorni kooperant',created_at:'2026-11-05',updated_at:'2026-11-05'};
    const cost={id:'cost',kooperant_id:'cooperator',opis:'Stavka',iznos:100,datum:'2026-11-05',created_at:'2026-11-05',placen:false};
    const flags=Object.fromEntries(busy.map(name=>[name,state===name?(name.endsWith('Id')?'pending':true):(name.endsWith('Id')?null:false)]));
    const component=load('../src/components/views/KooperantiView.tsx',{
      react:{useState:value=>[value,next=>states.push(next)],useEffect(){},useCallback:fn=>fn,useMemo:fn=>fn()},
      'react/jsx-runtime':jsxRuntime,
      'lucide-react':{Building2(){},CalendarDays(){},CircleDollarSign(){},ClipboardList(){},FileText(){},Handshake(){},LayoutGrid(){},ChevronDown(){},Pencil(){},Plus(){},Search(){},Table2(){},ArrowDown(){},ArrowUp(){},ArrowUpDown(){},Trash2(){},UploadCloud(){}},
      '@/auth/useAuth':{useAuth:()=>({canAccess:module=>module==='kooperanti'?state!=='denied':state!=='limited'})},
      '@/lib/useRequestScope':{useRequestScope:()=>({start:()=>()=>true,invalidate(){calls.push('invalidate');}})},
      '@/lib/localization':localization,
      '@/lib/aiKooperantRacun':{},
      '@/lib/api':{
        updateKooperant:async()=>{calls.push('write-cooperator');},
        createKooperant:async()=>{calls.push('write-cooperator');},
        deleteKooperant:async()=>{calls.push('delete-cooperator');},
        deleteKooperantDokument:async()=>{calls.push('delete-document');},
        deleteTrosak:async()=>{calls.push('delete-cost');},
        createTrosak:async()=>{calls.push('write-cost');},
        updateTrosak:async()=>{calls.push('pay-cost');},
        fetchKooperanti:async()=>{calls.push('cooperators');if(state==='reload-error')throw {message:'Kooperanti nisu dostupni'};return [cooperator];},
        fetchTroskovi:async()=>{calls.push('costs');return [];},
        fetchKooperantAngazmani:async()=>{calls.push('engagements');return [];},
        fetchGradilista:async()=>{calls.push('sites');return [];},
        fetchFakture:async()=>{calls.push('invoices');return [];},
      },
      '@/components/ui/Badge':{Badge(){}},
      '@/components/ui/EmptyState':{EmptyState(){}},
      '@/components/ui/ConfirmDialog':{ConfirmDialog:Dialog},
      '@/components/ui/Field':{Field(){},Select(){},TextInput(){},Textarea(){}},
      '@/components/ui/Modal':{Modal},
      '@/components/ui/ExportMenu':{ExportMenu(){}},
      '@/components/views/FuelChangeHistory':{CooperatorChangeHistoryPanel:Panel,EngagementChangeHistoryPanel:EngagementPanel},
      '@/components/views/ResourceDeletionHistory':{ResourceDeletionHistory:DeletionPanel},
    },{loading:false,items:[cooperator],prikaz:'kartice',historyCooperatorId:'cooperator',historyEngagementId:'engagement',
      angazmani:[{id:'engagement',kooperant_id:'cooperator',gradiliste_id:'site',status:'aktivno',created_at:'2026-11-05',updated_at:'2026-11-05',dogovoreni_iznos:null}],
      query:'Will hide cooperator',
      modalOpen:state==='modal',historyRestoring:state==='restoring',selected:['profile','restoring'].includes(state)?cooperator:null,
      deleteTarget:['delete','restoring'].includes(state)?cooperator:null,pendingDocumentDelete:['document-delete','restoring'].includes(state)?{id:'document'}:null,
      pendingCostDelete:['cost-delete','restoring'].includes(state)?{invoice:false,costs:state==='restoring'?[cost]:[]}:null,
      troskovi:state==='restoring'?[cost]:[],showCostForm:true,
      costForm:{opis:'Nacrt',iznos:'100',datum:'2026-11-05',gradiliste_id:''},
      form:{naziv:'Nacrt',iban:'',djelatnost:'',oib:'',adresa:'',mjesto:'',postanski_broj:'',kontakt_osoba:'',telefon:'',email:'',web:'',napomena:''},...flags});
    const elements=nodes(component.KooperantiView());
    const panel=elements.find(node=>node.type===Panel);
    const engagementPanel=elements.find(node=>node.type===EngagementPanel);
    const deletionPanel=elements.find(node=>node.type===DeletionPanel);
    if(state==='denied'){assert.equal(panel,undefined);assert.equal(engagementPanel,undefined);assert.equal(deletionPanel,undefined);continue;}
    assert.equal(deletionPanel.props.module,'kooperanti');
    assert.equal(deletionPanel.props.table,'kooperant_racuni');
    assert.equal(deletionPanel.props.disabled,panel.props.disabled);
    assert.equal(deletionPanel.props.onRestore,panel.props.onRestore);
    assert.equal(deletionPanel.props.onRestoringChange,panel.props.onRestoringChange);
    const selector=elements.find(node=>node.type==='select'&&node.props['aria-label']==='Kooperant za povijest izmjena');
    assert.equal(panel.props.recordId,'cooperator');
    assert.ok(nodes(selector).some(node=>node.type==='option'&&node.props.value==='cooperator'));
    assert.equal(panel.props.disabled,!['ready','reload-error','limited'].includes(state));
    assert.equal(selector.props.disabled,panel.props.disabled);
    assert.ok(!nodes(elements.find(node=>node.type==='fieldset')).some(node=>node.type===Panel));
    const engagementSelector=elements.find(node=>node.type==='select'&&node.props['aria-label']==='Angažman za povijest izmjena');
    assert.equal(engagementPanel.props.recordId,'engagement');
    assert.equal(engagementPanel.props.disabled,panel.props.disabled);
    assert.equal(engagementSelector.props.disabled,panel.props.disabled);
    assert.ok(nodes(engagementSelector).some(node=>node.type==='option'&&node.props.value==='engagement'));
    assert.equal(engagementPanel.props.onRestore,panel.props.onRestore);
    assert.equal(engagementPanel.props.onRestoringChange,panel.props.onRestoringChange);
    assert.ok(!nodes(elements.find(node=>node.type==='fieldset')).some(node=>node.type===EngagementPanel));
    if(state==='restoring'){
      assert.ok(elements.find(node=>node.type==='fieldset').props.disabled);
      for(const dialog of elements.filter(node=>node.type===Dialog))await dialog.props.onConfirm();
      const editor=elements.find(node=>node.type===Modal&&node.props.title==='Novi kooperant');
      nodes(editor.props.footer).find(node=>node.type==='button'&&node.props.children==='Spremi').props.onClick();
      elements.find(node=>node.type==='button'&&node.props.children==='Spremi').props.onClick();
      elements.find(node=>node.type==='button'&&node.props.children==='Označi plaćeno').props.onClick();
      await new Promise(resolve=>setImmediate(resolve));
      assert.deepEqual(calls,[],'Master save/delete, document/cost deletion, cost saving and payment writes are blocked');
      assert.deepEqual(states,[]);
    }
    panel.props.onRestoringChange(true);
    if(state==='reload-error'){
      await assert.rejects(panel.props.onRestore(),reason=>reason.message==='Kooperanti nisu dostupni');
      assert.ok(states.includes('Kooperanti nisu dostupni'));
    }else{
      await panel.props.onRestore();
      assert.ok(states.includes(null));
      assert.ok(states.includes(''));
      assert.ok(states.some(value=>value?.naziv===''&&value?.iban===''),'Discard cooperator draft');
      assert.ok(states.some(value=>value?.dogovoreni_iznos===''),'Discard engagement draft');
      assert.ok(states.some(value=>value?.opis===''&&value?.iznos===''),'Discard cost draft');
    }
    assert.deepEqual(calls,['invalidate','cooperators','costs','engagements',...(state==='limited'?[]:['sites','invoices'])]);
    assert.equal(states.filter(value=>value===true).length,1,'Strict reload must not set page loading and unmount history');
  }
});

test('engagement history RPC preserves bigint cursors and reports missing migrations and server errors', async () => {
  const {api,calls}=apiSetup({data:[],error:null});
  await api.fetchEngagementChangeHistory('engagement');
  await api.fetchEngagementChangeHistory('engagement','9007199254740993');
  await api.restoreEngagementChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['get_engagement_change_history',{p_record_id:'engagement',p_before_sequence:null}],
    ['get_engagement_change_history',{p_record_id:'engagement',p_before_sequence:'9007199254740993'}],
    ['restore_engagement_change',{p_history_id:'event'}],
  ]);
  for(const code of ['42P01','42883','PGRST202','PGRST205']){
    const missing=apiSetup({error:{code}}).api;
    await assert.rejects(missing.fetchEngagementChangeHistory('engagement'),/20261110190000/);
    await assert.rejects(missing.restoreEngagementChange('event'),/20261110190000/);
  }
  for(const code of ['42501','40001','23514','P0001']){
    const error={code,message:'Rejected'};
    const denied=apiSetup({error}).api;
    await assert.rejects(denied.fetchEngagementChangeHistory('engagement'),reason=>reason===error);
    await assert.rejects(denied.restoreEngagementChange('event'),reason=>reason===error);
  }
});

test('engagement undo previews exact amount stored status and dates and requires cooperator edit rights', async () => {
  const selected={...change,operation:'UPDATE',blocked_reason:null,
    before_data:{dogovoreni_iznos:1234.56,status:'aktivno',datum_pocetka:'2026-10-01',datum_zavrsetka:null,napomena:'Izvorno'},
    after_data:{dogovoreni_iznos:0,status:'otkazano',datum_pocetka:null,datum_zavrsetka:'2026-11-05',napomena:null}};
  const button=ui=>ui.elements.find(node=>node.type==='button'&&node.props.children?.includes('Vrati promjenu'));
  const ui=historyUI({selected,engagementHistory:true});
  button(ui).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ui.calls,[['engagement-restore','history'],['engagement-fetch','vehicle',undefined],'refresh-parent']);
  assert.deepEqual(ui.activity,[true,false]);
  for(const line of ['Dogovoreni iznos: 0 → 1.234,56','Status: Otkazano → Aktivno',
    'Datum početka: — → 01.10.2026.','Datum završetka: 05.11.2026. → —','Napomena: — → Izvorno']){
    assert.ok(ui.messages[0].includes(line),`${line}\n${ui.messages[0]}`);
  }
  const denied=historyUI({canEdit:false});
  assert.equal(denied.engagementPanel({recordId:'engagement',onRestore(){}}),null);
  assert.deepEqual(denied.permissions,[['kooperanti','edit']]);
  const wrapper=historyUI().engagementPanel({recordId:'engagement',onRestore(){},disabled:true});
  assert.equal(wrapper.props.engagementHistory,true);
  assert.equal(wrapper.props.vehicleId,'engagement');
  assert.equal(wrapper.props.disabled,true);
  for(const options of [{disabled:true},{confirmation:false},{selected:{...selected,can_restore:false,blocked_reason:'Nedostupan kooperant'}}]){
    const blocked=historyUI({selected,engagementHistory:true,...options});
    button(blocked).props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(blocked.calls,[]);
  }
  const failed=historyUI({selected,engagementHistory:true,error:{message:'Angažman ima noviju promjenu'}});
  button(failed).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(failed.calls,[['engagement-restore','history']]);
  assert.ok(failed.states.includes('Angažman ima noviju promjenu'));
  assert.deepEqual(failed.activity,[true,false]);
});

test('engagement list loads all pages with stable date and ID ordering and preserves optional cooperator scope', async () => {
  const pagination=load('../src/lib/pagination.ts',{});
  for(const cooperator of [undefined,'cooperator']){
    for(const fail of [false,true]){
      const calls=[];
      const error={message:'Angažmani nisu dostupni'};
      const api=load('../src/lib/api.ts',{
        './supabase':{supabase:{from:table=>({
          select:columns=>{
            const query={
              order:(field,options)=>{calls.push(['order',field,options.ascending]);return query;},
              eq:(field,value)=>{calls.push(['eq',field,value]);return query;},
              range:async(from,to)=>{
                calls.push([table,from,to]);
                if(fail&&from===500)return{error,data:null};
                return{error:null,data:Array.from({length:from===0?500:1},(_,id)=>({id:String(from+id)}))};
              },
            };
            assert.match(columns,/kooperanti:kooperant_id/);
            return query;
          },
        })}},
        './postavke':{},'./obracunSati':{},'./vehicleKmCosts':{},'./company':{},
        './pagination':pagination,'./rokovi':{},'./imageCompression':{},
      });
      if(fail)await assert.rejects(api.fetchKooperantAngazmani(cooperator),reason=>reason===error);
      else assert.equal((await api.fetchKooperantAngazmani(cooperator)).length,501);
      assert.deepEqual(calls,[
        ['order','datum_pocetka',false],['order','id',true],
        ...(cooperator?[['eq','kooperant_id',cooperator]]:[]),['kooperant_angazmani',0,499],
        ['order','datum_pocetka',false],['order','id',true],
        ...(cooperator?[['eq','kooperant_id',cooperator]]:[]),['kooperant_angazmani',500,999],
      ]);
    }
  }
});

test('catalog history RPC preserves cursors, scope and explicit migration or server errors', async () => {
  const {api,calls}=apiSetup({data:[],error:null});
  await api.fetchCatalogChangeHistory('catalog','9007199254740993');
  await api.restoreCatalogChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['get_catalog_change_history',{p_record_id:'catalog',p_before_sequence:'9007199254740993'}],
    ['restore_catalog_change',{p_history_id:'event'}],
  ]);
  for(const code of ['42P01','42883','PGRST202','PGRST205']){
    const missing=apiSetup({error:{code}}).api;
    await assert.rejects(missing.fetchCatalogChangeHistory('catalog'),/20261110200000/);
    await assert.rejects(missing.restoreCatalogChange('event'),/20261110200000/);
  }
  for(const code of ['42501','40001','23514','P0001']){
    const error={code,message:'Rejected'};
    const denied=apiSetup({error}).api;
    await assert.rejects(denied.fetchCatalogChangeHistory('catalog'),reason=>reason===error);
    await assert.rejects(denied.restoreCatalogChange('event'),reason=>reason===error);
  }
});

test('catalog undo previews exact price and fields with catalog edit rights and busy guards', async () => {
  const selected={...change,operation:'UPDATE',blocked_reason:null,
    before_data:{sifra:'A-01',naziv:'Izvorno',vrsta_posla:'Elektro',podgrupa:'Kablovi',jedinica:'m',cijena:1234.56,opis:'Izvorni opis'},
    after_data:{sifra:null,naziv:'Novo',vrsta_posla:null,podgrupa:null,jedinica:'kom',cijena:0,opis:null}};
  const button=ui=>ui.elements.find(node=>node.type==='button'&&node.props.children?.includes('Vrati promjenu'));
  const ui=historyUI({selected,catalogHistory:true});
  button(ui).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ui.calls,[['catalog-restore','history'],['catalog-fetch','vehicle',undefined],'refresh-parent']);
  assert.deepEqual(ui.activity,[true,false]);
  for(const line of ['Šifra: — → A-01','Vrsta posla: — → Elektro','Kataloška cijena: 0 → 1.234,56']){
    assert.ok(ui.messages[0].includes(line),line);
  }
  const denied=historyUI({canEdit:false});
  assert.equal(denied.catalogPanel({recordId:'catalog',onRestore(){}}),null);
  assert.deepEqual(denied.permissions,[['stavke','edit']]);
  assert.equal(historyUI().catalogPanel({recordId:'catalog',onRestore(){}}).props.catalogHistory,true);
  for(const options of [{disabled:true},{confirmation:false},{selected:{...selected,can_restore:false}}]){
    const blocked=historyUI({selected,catalogHistory:true,...options});
    button(blocked).props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(blocked.calls,[]);
  }
});

test('catalog writes rely on one atomic server operation and catalog reads paginate without hiding errors', async () => {
  const pagination=load('../src/lib/pagination.ts',{});
  const calls=[];
  let failure=null;
  const catalog=load('../src/lib/stavke.ts',{
    './pagination':pagination,
    './supabase':{supabase:{from:table=>{
      assert.equal(table,'stavke','No second client price-log write');
      const query={
        select:()=>query,single:async()=>({data:{id:'catalog'},error:failure}),
        insert:payload=>{calls.push(['insert',payload]);return query;},
        update:payload=>{calls.push(['update',payload]);return query;},
        eq:async(...args)=>{calls.push(['eq',...args]);return{error:failure};},
        order:field=>{calls.push(['order',field]);return query;},
        range:async(from,to)=>{calls.push(['range',from,to]);return{error:failure,data:Array.from({length:from===0?500:1},(_,id)=>({id:String(from+id)}))};},
      };
      return query;
    }}},
  });
  const input={naziv:'Stavka',cijena:123.45};
  await catalog.createStavka(input);
  await catalog.updateStavka('catalog',input);
  assert.equal(calls.filter(call=>call[0]==='insert').length,1);
  assert.equal(calls.filter(call=>call[0]==='update').length,1);
  assert.equal(Object.hasOwn(calls.find(call=>call[0]==='update')[1],'cijena_promijenjena_at'),false);
  calls.length=0;
  assert.equal((await catalog.fetchStavke()).length,501);
  assert.deepEqual(calls,[
    ['order','vrsta_posla'],['order','naziv'],['order','id'],['range',0,499],
    ['order','vrsta_posla'],['order','naziv'],['order','id'],['range',500,999],
  ]);
  failure={message:'Nedostupno'};
  await assert.rejects(catalog.fetchStavke(),reason=>reason===failure);
  await assert.rejects(catalog.createStavka(input),/Nedostupno/);
  await assert.rejects(catalog.updateStavka('catalog',input),/Nedostupno/);
});

test('catalog screen locks editing and pending detail writes and strictly refreshes without unmounting history', async () => {
  for(const state of ['ready','denied','saving','modal','restoring','expanded','detail-writing','delete','reload-error']){
    const calls=[];
    const states=[];
    const Panel=()=>null;
    const Modal=()=>null;
    const Dialog=()=>null;
    const item={id:'catalog',naziv:'Izvorna stavka',sifra:'A',cijena:1234.56,jedinica:'m'};
    const component=load('../src/components/views/StavkeView.tsx',{
      react:{useState:value=>[value,next=>states.push(next)],useEffect(){},useCallback:fn=>fn,useMemo:fn=>fn()},
      'react/jsx-runtime':jsxRuntime,
      'lucide-react':{ChevronDown(){},ChevronRight(){},ListChecks(){},Pencil(){},Plus(){},Search(){},Trash2(){},History(){},MapPin(){}},
      '@/auth/useAuth':{useAuth:()=>({canAccess:(...args)=>{assert.deepEqual(args,['stavke','edit']);return state!=='denied';}})},
      '@/lib/useRequestScope':{useRequestScope:()=>({start:()=>()=>true,invalidate(){}})},
      '@/lib/localization':localization,
      '@/lib/api':{fetchGradilista:async()=>{calls.push('sites');return [];}},
      '@/lib/stavke':{
        fetchStavke:async()=>{calls.push('catalog');if(state==='reload-error')throw {message:'Stavke nisu dostupne'};return [item];},
        fetchStavkeBrojKoristenja:async()=>{calls.push('counts');return new Map();},
        createStavka:async()=>{calls.push('create');},
        updateStavka:async()=>{calls.push('update');},
        deleteStavka:async()=>{calls.push('delete');},
      },
      '@/components/views/FuelChangeHistory':{CatalogChangeHistoryPanel:Panel},
      '@/components/ui/EmptyState':{EmptyState(){}},
      '@/components/ui/ConfirmDialog':{ConfirmDialog:Dialog},
      '@/components/ui/Field':{Field(){},Select(){},TextInput(){},Textarea(){}},
      '@/components/ui/Modal':{Modal},
      '@/components/ui/ExportMenu':{ExportMenu(){}},
    },{loading:false,items:[item],counts:{},historyCatalogId:'catalog',query:'Will hide item',vrsta:'hidden',
      saving:state==='saving',modalOpen:state==='modal',historyRestoring:state==='restoring',detailWriting:state==='detail-writing',
      expanded:state==='expanded'?'catalog':null,deleteTarget:['delete','restoring'].includes(state)?item:null,
      form:{naziv:'Nacrt',sifra:'',vrsta_posla:'',podgrupa:'',jedinica:'m',cijena:'100',opis:''}});
    const elements=nodes(component.StavkeView());
    const panel=elements.find(node=>node.type===Panel);
    if(state==='denied'){assert.equal(panel,undefined);continue;}
    const selector=elements.find(node=>node.type==='select'&&node.props['aria-label']==='Stavka za povijest izmjena');
    assert.equal(panel.props.disabled,!['ready','reload-error'].includes(state));
    assert.equal(selector.props.disabled,panel.props.disabled);
    assert.ok(nodes(selector).some(node=>node.type==='option'&&node.props.value==='catalog'));
    assert.ok(!nodes(elements.find(node=>node.type==='fieldset')).some(node=>node.type===Panel));
    if(state==='restoring'){
      const editor=elements.find(node=>node.type===Modal);
      nodes(editor.props.footer).find(node=>node.type==='button'&&node.props.children==='Spremi').props.onClick();
      await elements.find(node=>node.type===Dialog).props.onConfirm();
      await new Promise(resolve=>setImmediate(resolve));
      assert.deepEqual(calls,[]);
    }
    panel.props.onRestoringChange(true);
    if(state==='reload-error')await assert.rejects(panel.props.onRestore(),reason=>reason.message==='Stavke nisu dostupne');
    else await panel.props.onRestore();
    assert.ok(states.some(value=>value?.naziv===''&&value?.cijena===''));
    assert.deepEqual(calls,['catalog','sites',...(state==='reload-error'?[]:['counts'])]);
    assert.equal(states.filter(value=>value===true).length,1,'Strict reload keeps history mounted');
  }
});

test('task update history preserves bigint cursors, sends only package IDs and surfaces missing-migration and server errors', async () => {
  const { api, calls }=apiSetup({data:[],error:null});
  await api.fetchTaskChangeHistory('task');
  await api.fetchTaskChangeHistory('task','9007199254740993');
  await api.restoreTaskChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['get_task_change_history',{p_record_id:'task',p_before_sequence:null}],
    ['get_task_change_history',{p_record_id:'task',p_before_sequence:'9007199254740993'}],
    ['restore_task_change',{p_history_id:'event'}],
  ]);
  for(const code of ['42P01','42883','PGRST202','PGRST205']) {
    const missing=apiSetup({error:{code}}).api;
    await assert.rejects(missing.fetchTaskChangeHistory('task'),/20261110140000/);
    await assert.rejects(missing.restoreTaskChange('event'),/20261110140000/);
  }
  for(const code of ['42501','40001','23503','P0001']) {
    const error={code,message:'Rejected'};
    const denied=apiSetup({error}).api;
    await assert.rejects(denied.fetchTaskChangeHistory('task'),reason=>reason===error);
    await assert.rejects(denied.restoreTaskChange('event'),reason=>reason===error);
  }
});

test('task and order history pickers load all pages and normalize site joins without swallowing errors', async () => {
  const pagination=load('../src/lib/pagination.ts',{});
  for(const kind of ['task','order']) {
  for(const fail of [false,true]) {
    const calls=[];
    const error={message:'Popis nije dostupan'};
    const api=load('../src/lib/api.ts',{
      './supabase':{supabase:{from:(table)=>({
        select:(columns)=>({order:(order)=>({range:async(from,to)=>{
          calls.push([table,columns,order,from,to]);
          if(fail)return{error,data:null};
          return{error:null,data:from===0
            ?Array.from({length:500},(_,id)=>({id:String(id),naziv:'Bez roka',vrsta:'zadatak',gradilista:[{naziv:'Gradilište'}]}))
            :[{id:'500',naziv:'Bez gradilišta',vrsta:'dodatni',gradilista:[]},{id:'501',naziv:'Objekt',vrsta:'zadatak',gradilista:{naziv:'Objekt'}}]};
        }})}),
      })}},
      './postavke':{},'./obracunSati':{},'./vehicleKmCosts':{},'./company':{},
      './pagination':pagination,'./rokovi':{},'./imageCompression':{},
    });
    const fetch=kind==='order'?api.fetchOrderHistoryRecords:api.fetchTaskHistoryRecords;
    if(fail)await assert.rejects(fetch(),reason=>reason===error);
    else {
      const records=await fetch();
      assert.equal(records.length,502);
      assert.equal(records[0].gradilista.naziv,'Gradilište');
      assert.equal(records[500].gradilista,null);
      assert.equal(records[501].gradilista.naziv,'Objekt');
      assert.deepEqual(calls.map(call=>call.slice(2)),[['id',0,499],['id',500,999]]);
      assert.equal(calls[0][0],kind==='order'?'radni_nalozi':'gradiliste_zadaci');
      if(kind==='order')assert.match(calls[0][1],/naziv:naslov/);
    }
  }
  }
});

test('task undo previews exact task and original deadline range, uses site edit rights and never writes when blocked', async () => {
  const selected={
    ...change,operation:'UPDATE',blocked_reason:null,
    before_data:{naziv:'Prije',rok:'2026-11-09',gotovo:false,gotovo_at:null},
    after_data:{naziv:'Poslije',rok:null,gotovo:true,gotovo_at:'2026-11-05T05:00:00Z'},
    before_deadlines:[{id:'original',naziv:'Izvorni rok',datum:'2026-11-09',datum_pocetka:'2026-11-01',
      datum_zavrsetka:'2026-11-09',status:'otvoren',opis:'Stara napomena',kooperant_id:'contractor',nalog_id:null,gradiliste_id:'site'}],
    after_deadlines:[],
  };
  const button=ui=>ui.elements.find(node=>node.type==='button'&&node.props.children?.includes('Vrati promjenu'));
  const ui=historyUI({selected,taskHistory:true});
  button(ui).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(ui.calls,[['task-restore','history'],['task-fetch','vehicle',undefined],'refresh-parent']);
  assert.deepEqual(ui.activity,[true,false]);
  assert.match(ui.messages[0],/Dovršeno: Da → Ne/);
  assert.match(ui.messages[0],/Izvorni rok/);
  assert.match(ui.messages[0],/01\.11\.2026.*09\.11\.2026/);
  assert.match(ui.messages[0],/Stara napomena/);
  assert.match(ui.messages[0],/ID: original/);
  assert.match(ui.messages[0],/Nalog, obračuni i drugi zapisi ne mijenjaju se/);
  assert.ok(ui.elements.some(node=>node.props.children==='Nema povezanih rokova.'));
  assert.ok(!ui.elements.some(node=>node.props.children==='Izmijenjeno točenje'));
  const denied=historyUI({canEdit:false});
  assert.equal(denied.taskPanel({recordId:'task',onRestore(){}}),null);
  assert.deepEqual(denied.permissions,[['gradilista','edit']]);
  const wrapper=historyUI().taskPanel({recordId:'task',onRestore(){}});
  assert.equal(wrapper.props.taskHistory,true);
  assert.equal(wrapper.props.vehicleId,'task');
  for(const options of [{disabled:true},{confirmation:false},{selected:{...selected,can_restore:false,blocked_reason:'Rokovi su promijenjeni'}}]){
    const blocked=historyUI({selected,taskHistory:true,...options});
    button(blocked).props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(blocked.calls,[]);
  }
  const failed=historyUI({selected,taskHistory:true,error:{message:'Rokovi su promijenjeni'}});
  button(failed).props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(failed.calls,[['task-restore','history']]);
  assert.ok(failed.states.includes('Rokovi su promijenjeni'));
  assert.deepEqual(failed.activity,[true,false]);
});

test('contracted work update RPCs retain bigint cursors, restore only an event and surface explicit errors', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.fetchContractedWorkChangeHistory('work');
  await api.fetchContractedWorkChangeHistory('work', '9007199254740993');
  await api.restoreContractedWorkChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_contracted_work_change_history', { p_record_id: 'work', p_before_sequence: null }],
    ['get_contracted_work_change_history', { p_record_id: 'work', p_before_sequence: '9007199254740993' }],
    ['restore_contracted_work_change', { p_history_id: 'event' }],
  ]);
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const missing = apiSetup({ error: { code } }).api;
    await assert.rejects(missing.fetchContractedWorkChangeHistory('work'), /20261110120000/);
    await assert.rejects(missing.restoreContractedWorkChange('event'), /20261110120000/);
  }
  for (const code of ['42501', '40001', '23503', 'P0001']) {
    const error = { code, message: 'Rejected' };
    const denied = apiSetup({ error }).api;
    await assert.rejects(denied.fetchContractedWorkChangeHistory('work'), (reason) => reason === error);
    await assert.rejects(denied.restoreContractedWorkChange('event'), (reason) => reason === error);
  }
});

test('contracted work update preview routes undo with site permissions and exact Croatian financial values', async () => {
  const selected = {
    ...change, operation: 'UPDATE', blocked_reason: null,
    before_data: { naziv: 'Izvorno', ugovoreni_iznos: 1234.56, ostvareni_iznos: 789.12, status: 'u_tijeku', gradiliste_id: 'site' },
    after_data: { naziv: 'Novo', ugovoreni_iznos: 78.91, ostvareni_iznos: 12.34, status: 'zavrseno', gradiliste_id: null },
  };
  const button = (ui) => ui.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu'));
  const ui = historyUI({ selected, contractedWorkHistory: true });
  button(ui).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ui.calls, [['work-restore', 'history'], ['work-fetch', 'vehicle', undefined], 'refresh-parent']);
  assert.deepEqual(ui.activity, [true, false]);
  assert.match(ui.messages[0], /Ugovoreni iznos: 78,91 → 1\.234,56/);
  assert.match(ui.messages[0], /Ostvareni iznos: 12,34 → 789,12/);
  assert.match(ui.messages[0], /Status: Završeno → U tijeku/);
  const denied = historyUI({ canEdit: false });
  assert.equal(denied.contractedPanel({ recordId: 'work', onRestore() {} }), null);
  assert.deepEqual(denied.permissions, [['gradilista', 'edit']]);
  const panel = historyUI().contractedPanel({ recordId: 'work', disabled: true, onRestore() {} });
  assert.equal(panel.props.contractedWorkHistory, true);
  assert.equal(panel.props.vehicleId, 'work');
  for (const options of [{ disabled: true }, { confirmation: false }, { selected: { ...selected, can_restore: false, blocked_reason: 'Nepodržana izmjena ponude' } }]) {
    const blocked = historyUI({ selected, contractedWorkHistory: true, ...options });
    button(blocked).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(blocked.calls, []);
  }
  const failed = historyUI({ selected, contractedWorkHistory: true, error: { message: 'Rad ima noviju promjenu' } });
  button(failed).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failed.calls, [['work-restore', 'history']]);
  assert.ok(failed.states.includes('Rad ima noviju promjenu'));
});

test('site work/task-history selectors gate permissions, preserve active history during refresh and surface fetch failures', async () => {
  for (const kind of ['work', 'task', 'order']) {
  const taskHistory = kind === 'task';
  const orderHistory = kind === 'order';
  for (const state of ['ready', 'disabled', 'restoring', 'loading', 'error', 'fetch-error', 'readonly', 'stale']) {
    const calls = [];
    const states = [];
    const permissions = [];
    const Panel = () => null;
    const component = load('../src/components/views/ContractedWorkHistory.tsx', {
      react: { useState: (initial) => [initial, (value) => states.push(value)], useEffect() {}, useCallback: (fn) => fn },
      'react/jsx-runtime': jsxRuntime,
      './HistoryDialog': historyDialogMock,
      '@/auth/useAuth': { useAuth: () => ({ canAccess: (...args) => { permissions.push(args); return state !== 'readonly'; } }) },
      '@/lib/api': {
        fetchUgovoreniRadovi: async () => { calls.push('fetch'); if (state === 'fetch-error') throw { message: 'Radovi nisu dostupni' }; return [{ id: 'work', naziv: 'Novi naziv' }]; },
        fetchTaskHistoryRecords: async () => { calls.push('task-fetch'); if (state === 'fetch-error') throw { message: 'Zadaci nisu dostupni' }; return [{ id: 'work', naziv: 'Novi naziv' }]; },
        fetchOrderHistoryRecords: async () => { calls.push('order-fetch'); if (state === 'fetch-error') throw { message: 'Nalozi nisu dostupni' }; return [{ id: 'work', naziv: 'Novi naziv' }]; },
      },
      '@/lib/useRequestScope': { useRequestScope: () => ({ start: () => () => state !== 'stale', invalidate() {} }) },
      './FuelChangeHistory': { ContractedWorkChangeHistoryPanel: Panel, TaskChangeHistoryPanel: Panel, OrderChangeHistoryPanel: Panel },
    }, { open: true, selectedId: 'work', items: [{ id: 'work', naziv: 'Rad', vrsta: 'vtr', gradilista: { naziv: 'Gradilište' } }],
      loading: state === 'loading', restoring: state === 'restoring', error: state === 'error' ? 'Pogreška' : null });
    const props = { disabled: state === 'disabled', refreshVersion: 0,
      onRestoringChange: (value) => calls.push(value), onRestore: async () => { calls.push('refresh-parent'); throw new Error('Refresh failed'); } };
    const outer = orderHistory ? component.OrderHistory(props) : taskHistory ? component.TaskHistory(props) : component.ContractedWorkHistory(props);
    assert.deepEqual(permissions, [[orderHistory ? 'radni_nalozi' : 'gradilista', 'edit']]);
    if (state === 'readonly') {
      assert.equal(outer, null);
      assert.deepEqual(calls, []);
      continue;
    }
    const elements = nodes(outer.type(outer.props));
    const history = elements.find((node) => node.type === Panel);
    assert.equal(history.props.recordId, 'work');
    assert.equal(history.props.disabled, ['disabled', 'loading', 'error'].includes(state));
    const select = elements.find((node) => node.type === 'select');
    assert.equal(select.props.disabled, ['disabled', 'loading', 'restoring'].includes(state));
    assert.ok(history, 'Loading/error must not unmount the active history or discard restore notifications');
    if (state === 'restoring') {
      assert.equal(elements.find((node) => node.type === 'button' && node.props['ariaLabel'])?.props.disabled, true);
      continue;
    }
    if (['ready', 'fetch-error', 'stale'].includes(state)) {
      await elements.find((node) => node.type === 'button' && node.props.children === (orderHistory ? 'Osvježi popis naloga' : taskHistory ? 'Osvježi popis zadataka' : 'Osvježi popis radova')).props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(calls, [orderHistory ? 'order-fetch' : taskHistory ? 'task-fetch' : 'fetch']);
      if (state === 'fetch-error') assert.ok(states.includes(orderHistory ? 'Nalozi nisu dostupni' : taskHistory ? 'Zadaci nisu dostupni' : 'Radovi nisu dostupni'));
      else if (state === 'stale') assert.equal(states.length, 2, 'Stale response cannot replace options');
      else {
        const keepSelection = states.find((value) => typeof value === 'function');
        assert.equal(keepSelection('work'), 'work');
        assert.equal(keepSelection('deleted'), '');
        history.props.onRestoringChange(true);
        assert.equal(calls.at(-1), true);
        await assert.rejects(history.props.onRestore(), /Refresh failed/);
      }
    }
  }
  }
});

test('work-history selector fetches lazily and ignores results after closing or changing request scope', async () => {
  const slots = [];
  const effects = [];
  const pending = [];
  let index = 0;
  let version = 0;
  const scope = {
    start() { const request = ++version; return () => request === version; },
    invalidate() { version++; },
  };
  const component = load('../src/components/views/ContractedWorkHistory.tsx', {
    react: {
      useState(initial) {
        const key = index++;
        if (!(key in slots)) slots[key] = initial;
        return [slots[key], (value) => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }];
      },
      useEffect: (fn) => effects.push(fn), useCallback: (fn) => fn,
    },
    'react/jsx-runtime': jsxRuntime,
    './HistoryDialog': historyDialogMock,
    '@/auth/useAuth': { useAuth: () => ({ canAccess: () => true }) },
    '@/lib/api': { fetchUgovoreniRadovi: () => new Promise((resolve) => pending.push(resolve)) },
    '@/lib/useRequestScope': { useRequestScope: () => scope },
    './FuelChangeHistory': { ContractedWorkChangeHistoryPanel: () => null },
  });
  const props = { disabled: false, refreshVersion: 0, onRestore: async () => {}, onRestoringChange() {} };
  const render = () => {
    index = 0;
    effects.length = 0;
    const outer = component.ContractedWorkHistory(props);
    return nodes(outer.type(outer.props));
  };
  let elements = render();
  let cleanup = effects[0]();
  assert.equal(pending.length, 0, 'Closed history must not fetch the complete work list');
  elements.find((node) => node.type === 'button').props.onClick();
  cleanup();
  render();
  cleanup = effects[0]();
  assert.equal(pending.length, 1);
  cleanup();
  pending[0]([{ id: 'stale', naziv: 'Old request' }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slots[1].length, 0, 'Cancelled effect cannot populate options');
  render();
  cleanup = effects[0]();
  assert.equal(pending.length, 2);
  pending[1]([{ id: 'current', naziv: 'Current request' }]);
  await new Promise((resolve) => setImmediate(resolve));
  elements = render();
  assert.ok(elements.some((node) => node.type === 'option' && node.props.value === 'current'));
  assert.equal(slots[3], false, 'Latest response releases the loading state');
  cleanup();
});

test('contracted work deletion retains file bytes, uses protected RPCs and surfaces missing migrations and server errors', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.deleteUgovoreniRad('work');
  await api.fetchContractedWorkDeletions();
  await api.fetchContractedWorkDeletions({ id: 'cursor', created_at: '2026-11-09T08:00:00Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['delete_contracted_work_with_history', { p_record_id: 'work' }],
    ['get_contracted_work_deletions', { p_before_time: null, p_before_id: null }],
    ['get_contracted_work_deletions', { p_before_time: '2026-11-09T08:00:00Z', p_before_id: 'cursor' }],
  ]);
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const missing = apiSetup({ error: { code } }).api;
    await assert.rejects(missing.deleteUgovoreniRad('work'), /20261110110000/);
    await assert.rejects(missing.fetchContractedWorkDeletions(), /20261110110000/);
  }
  for (const code of ['42501', '40001', '23503', 'P0001']) {
    const error = { code, message: 'Rejected' };
    const denied = apiSetup({ error }).api;
    await assert.rejects(denied.deleteUgovoreniRad('work'), (reason) => reason === error);
    await assert.rejects(denied.fetchContractedWorkDeletions(), (reason) => reason === error);
  }
});

test('contracted work history previews original amounts and attachment and enforces site rather than offer edit permissions', async () => {
  const selected = {
    id: 'work', snapshot: { vrsta: 'vtr', naziv: 'Fasada', ugovoreni_iznos: 1234.56, ostvareni_iznos: 789.12, dokument_naziv: 'Izvorni dokument.pdf' },
    actor_name: 'Ured', created_at: '2026-11-04T08:00:00Z', expires_at: '2026-12-04T08:00:00Z',
    reversed_at: null, can_restore: true, affected_rows: { ugovoreni_radovi: 1 },
  };
  const ui = deletionUI({ selected, module: 'gradilista', table: 'ugovoreni_radovi' });
  bundleRestoreButton(ui.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ui.calls, [['restore', 'work'], ['fetch-works', undefined], 'refresh-parent']);
  assert.deepEqual(ui.permissions, [['gradilista', 'edit']]);
  assert.deepEqual(ui.activity, [true, false]);
  assert.match(ui.messages[0], /obrisani ugovoreni\/VTR rad/);
  assert.match(ui.messages[0], /VTR · Fasada · Ugovoreno: 1\.234,56/);
  assert.match(ui.messages[0], /Ostvareno: 789,12/);
  assert.match(ui.messages[0], /Prilog: Izvorni dokument\.pdf/);
  assert.match(ui.messages[0], /Ugovoreni i VTR radovi: 1/);
  const denied = deletionUI({ module: 'gradilista', table: 'ugovoreni_radovi', canEdit: false });
  assert.equal(denied.elements.length, 0);
  assert.deepEqual(denied.permissions, [['gradilista', 'edit']]);
  for (const options of [{ disabled: true }, { confirm: false }, { selected: { ...selected, can_restore: false } }]) {
    const blocked = deletionUI({ selected, module: 'gradilista', table: 'ugovoreni_radovi', ...options });
    bundleRestoreButton(blocked.elements).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(blocked.calls, []);
  }
});

test('contracted work recovery locks legacy editor, clears drafts and filters and propagates strict refresh failures', async () => {
  for (const state of ['ready', 'saving', 'restoring', 'reload-error', 'delete-error']) {
    const calls = [];
    const states = [];
    const Panel = () => null;
    const UpdatePanel = () => null;
    const Modal = () => null;
    const Confirm = () => null;
    const component = load('../src/components/views/UgovoreniRadoviView.tsx', {
      react: { useState: (initial) => [typeof initial === 'function' ? initial() : initial, (value) => states.push(value)], useEffect() {} },
      'react/jsx-runtime': jsxRuntime,
      'lucide-react': new Proxy({}, { get: () => () => null }),
      '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory: Panel },
      '@/components/views/FuelChangeHistory': { ContractedWorkChangeHistoryPanel: UpdatePanel },
      '@/components/ui/Modal': { Modal },
      '@/components/ui/Field': { Field() {}, TextInput() {}, Select() {}, Textarea() {} },
      '@/components/ui/Badge': { Badge() {} },
      '@/components/ui/EmptyState': { EmptyState() {} },
      '@/components/ui/ConfirmDialog': { ConfirmDialog: Confirm },
      '@/lib/api': {
        fetchUgovoreniRadovi: async () => { calls.push('works'); return []; },
        fetchGradilista: async () => { calls.push('sites'); if (state === 'reload-error') throw { message: 'Gradilišta nisu dostupna' }; return []; },
        createUgovoreniRad: async () => calls.push('create'),
        updateUgovoreniRad: async () => calls.push('update'),
        deleteUgovoreniRad: async () => { calls.push('delete'); if (state === 'delete-error') throw { message: 'Brisanje odbijeno' }; },
      },
    }, {
      loading: false, saving: state === 'saving', historyRestoring: state === 'restoring',
      modalOpen: true, editing: { id: 'work' }, deleteId: 'work', filterGradiliste: 'site',
      form: { gradiliste_id: 'site', naziv: 'Nacrt', opis: 'Nacrt', ugovoreni_iznos: '100', ostvareni_iznos: '10', status: 'planirano' },
    });
    const elements = nodes(component.UgovoreniRadoviView());
    const history = elements.find((node) => node.type === Panel);
    const updates = elements.find((node) => node.type === UpdatePanel);
    assert.equal(updates.props.recordId, 'work');
    assert.equal(updates.props.disabled, state === 'saving' || state === 'restoring');
    assert.equal(updates.props.onRestore, history.props.onRestore);
    assert.equal(updates.props.onRestoringChange, history.props.onRestoringChange);
    assert.equal(history.props.module, 'gradilista');
    assert.equal(history.props.table, 'ugovoreni_radovi');
    assert.equal(history.props.disabled, state === 'saving' || state === 'restoring');
    const modal = elements.find((node) => node.type === Modal);
    const save = nodes(modal.props.footer).find((node) => node.type === 'button' && node.props.children !== 'Odustani');
    const confirm = elements.find((node) => node.type === Confirm);
    assert.match(confirm.props.message, /sačuvani prilog/);
    assert.match(confirm.props.message, /30 dana/);
    if (['saving', 'restoring'].includes(state)) {
      assert.equal(save.props.disabled, true);
      assert.ok(elements.filter((node) => node.type === 'fieldset').every((node) => node.props.disabled));
      await save.props.onClick();
      await confirm.props.onConfirm();
      modal.props.onClose();
      assert.deepEqual(calls, []);
      assert.deepEqual(states, []);
    } else if (state === 'delete-error') {
      await confirm.props.onConfirm();
      assert.deepEqual(calls, ['delete']);
      assert.ok(states.includes('Brisanje odbijeno'));
      assert.equal(states.at(-1), false);
    } else {
      if (state === 'reload-error') await assert.rejects(history.props.onRestore(), (e) => e.message === 'Gradilišta nisu dostupna');
      else await history.props.onRestore();
      assert.equal(states.filter((value) => value === null).length, 3, 'Clears editing, deletion and prior error');
      assert.equal(states.filter((value) => value === '').length, 1, 'Clears site filter');
      assert.ok(states.some((value) => value?.naziv === '' && value?.ugovoreni_iznos === ''));
      assert.deepEqual(calls, ['works', 'sites']);
    }
  }
});

test('site work recovery is globally reachable and VTR deletion never removes retained document bytes', () => {
  const sites = readFileSync(new URL('../src/components/views/GradilistaView.tsx', import.meta.url), 'utf8');
  assert.match(sites, /<ResourceDeletionHistory\s+module="gradilista"\s+table="ugovoreni_radovi"\s+refreshVersion=\{deletionVersion\}\s+onRestore=\{afterDeletionRestore\}/);
  const detail = readFileSync(new URL('../src/components/views/GradilisteDetailsPanel.tsx', import.meta.url), 'utf8');
  const remove = detail.slice(detail.indexOf('const removeVtr ='), detail.indexOf('const openCostEditor ='));
  assert.match(remove, /if \(savingVtr\) return/);
  assert.match(remove, /setSavingVtr\(true\)/);
  assert.match(remove, /deleteUgovoreniRad\(item\.id\)/);
  assert.match(remove, /u modulu Gradilišta/);
  assert.match(remove, /finally\s*\{\s*setSavingVtr\(false\)/);
  assert.doesNotMatch(remove, /deleteUgovoreniRadDokument|storage|\.remove\(/);
});

test('invoice deletion uses protected RPCs, lossless cursors and explicit missing-migration and server errors', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.deleteFaktura('invoice');
  await api.fetchResourceDeletions('fakture');
  await api.fetchInvoiceDeletions({ id: 'cursor', created_at: '2026-11-09T08:00:00Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['delete_invoice_with_history', { p_record_id: 'invoice' }],
    ['get_invoice_deletions', { p_before_time: null, p_before_id: null }],
    ['get_invoice_deletions', { p_before_time: '2026-11-09T08:00:00Z', p_before_id: 'cursor' }],
  ]);
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const missing = apiSetup({ error: { code } }).api;
    await assert.rejects(missing.deleteFaktura('invoice'), /20261110090000/);
    await assert.rejects(missing.fetchResourceDeletions('fakture'), /20261110090000/);
  }
  for (const code of ['42501', '40001', '23503', 'P0001']) {
    const error = { code, message: 'Rejected' };
    const denied = apiSetup({ error }).api;
    await assert.rejects(denied.deleteFaktura('invoice'), (reason) => reason === error);
    await assert.rejects(denied.fetchInvoiceDeletions(), (reason) => reason === error);
  }
});

test('invoice recovery previews buyer, original amounts, rebate direction and payment, and checks invoice permissions', async () => {
  const selected = {
    id: 'invoice', snapshot: { broj: 'F-2026-001', kupac: 'Kupac', datum_izdavanja: '2026-11-09',
      iznos: 1234.56, rabat: 12.34, rabat_smjer: 'oduzmi', status: 'placena', datum_naplate: '2026-11-10' },
    actor_name: 'Ured', created_at: '2026-11-04T08:00:00Z', expires_at: '2026-12-04T08:00:00Z',
    reversed_at: null, can_restore: true, affected_rows: { fakture: 1 },
  };
  for (const mode of ['oduzmi', 'pribroji']) {
    const ui = deletionUI({ selected: { ...selected, snapshot: { ...selected.snapshot, rabat_smjer: mode } }, module: 'fakture' });
    bundleRestoreButton(ui.elements).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(ui.calls, [['restore', 'invoice'], ['fetch', 'fakture', undefined], 'refresh-parent']);
    assert.deepEqual(ui.permissions, [['fakture', 'edit']]);
    assert.deepEqual(ui.activity, [true, false]);
    assert.match(ui.messages[0], /obrisanu fakturu/);
    assert.match(ui.messages[0], /F-2026-001 · Kupac · 09\.11\.2026\./);
    assert.match(ui.messages[0], /Osnovni iznos: 1\.234,56/);
    assert.match(ui.messages[0], mode === 'oduzmi' ? /Rabat \(oduzima se\): 12,34/ : /Rabat \(pribraja se\): 12,34/);
    assert.match(ui.messages[0], /Plaćena · Naplaćeno: 10\.11\.2026\./);
  }
  const denied = deletionUI({ module: 'fakture', canEdit: false });
  assert.equal(denied.elements.length, 0);
  assert.deepEqual(denied.permissions, [['fakture', 'edit']]);
  const busy = deletionUI({ selected, module: 'fakture', disabled: true });
  bundleRestoreButton(busy.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(busy.calls, []);
});

test('invoice recovery locks editor and investor writes, resets all stale filters and exposes refresh and delete failures', async () => {
  for (const state of ['ready', 'saving', 'investor-saving', 'restoring', 'reload-error', 'delete-error', 'deleted']) {
    const calls = [];
    const states = [];
    const Panel = () => null;
    const UpdatePanel = () => null;
    const Modal = () => null;
    const Confirm = () => null;
    const component = load('../src/components/views/FaktureView.tsx', {
      react: { useState: (initial) => [typeof initial === 'function' ? initial() : initial, (value) => states.push(value)], useEffect() {} },
      'react/jsx-runtime': jsxRuntime,
      'lucide-react': new Proxy({}, { get: () => () => null }),
      '@/lib/localization': localization,
      '@/auth/useAuth': { useAuth: () => ({ company: { postavke: { invoice_rebate_mode: 'pribroji' } } }) },
      '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory: Panel },
      '@/components/views/FuelChangeHistory': { InvoiceChangeHistoryPanel: UpdatePanel },
      '@/components/ui/Modal': { Modal },
      '@/components/ui/Field': { Field() {}, TextInput() {}, Select() {}, Textarea() {} },
      '@/components/ui/Badge': { Badge() {} },
      '@/components/ui/ExportMenu': { ExportMenu() {} },
      '@/components/ui/EmptyState': { EmptyState() {} },
      '@/components/ui/ConfirmDialog': { ConfirmDialog: Confirm },
      '@/lib/api': {
        fetchFakture: async () => { calls.push('invoices'); return []; },
        fetchGradilista: async () => { calls.push('sites'); return []; },
        fetchInvestitori: async () => { calls.push('investors'); if (state === 'reload-error') throw { message: 'Investitori nisu dostupni' }; return []; },
        createInvestitor: async () => { calls.push('investor-create'); return { id: 'new', naziv: 'Novi' }; },
        createFaktura: async () => calls.push('create'),
        updateFaktura: async () => calls.push('update'),
        deleteFaktura: async () => { calls.push('delete'); if (state === 'delete-error') throw { message: 'Brisanje odbijeno' }; },
        iznosFakture: (f) => f.rabat_smjer === 'oduzmi' ? f.iznos - (f.rabat ?? 0) : f.iznos + (f.rabat ?? 0),
      },
    }, {
      loading: false, saving: state === 'saving', savingInvestor: state === 'investor-saving', historyRestoring: state === 'restoring',
      modalOpen: true, editing: { id: 'invoice' }, deleteId: 'invoice', newInv: 'Novi',
      filterGradiliste: 'site', filterInvestitor: 'investor', filterStatus: 'placena', query: 'staro', od: '2026-11-01', doDatuma: '2026-11-30',
      form: { gradiliste_id: 'site', investitor_id: 'investor', broj: 'Nacrt', kupac: 'Kupac', iznos: '100', rabat: '0',
        datum_izdavanja: '2026-11-09', datum_dospjecja: '', datum_naplate: '', status: 'izdana', opis: 'Nacrt' },
    });
    const elements = nodes(component.FaktureView());
    const history = elements.find((node) => node.type === Panel);
    const updates = elements.find((node) => node.type === UpdatePanel);
    assert.equal(updates.props.recordId, 'invoice');
    assert.equal(updates.props.disabled, state === 'saving' || state === 'investor-saving');
    assert.equal(updates.props.onRestore, history.props.onRestore, 'Deletion and update recovery share the same reset and strict refresh');
    assert.equal(updates.props.onRestoringChange, history.props.onRestoringChange);
    assert.equal(history.props.module, 'fakture');
    assert.equal(history.props.disabled, state === 'saving' || state === 'investor-saving');
    const modal = elements.find((node) => node.type === Modal);
    const save = nodes(modal.props.footer).find((node) => node.type === 'button' && node.props.children !== 'Odustani');
    const confirm = elements.find((node) => node.type === Confirm);
    const addInvestor = elements.find((node) => node.type === 'button' && node.props.children === 'Dodaj');
    assert.match(confirm.props.message, /30 dana/);
    assert.match(confirm.props.message, /nije storno/);
    if (['saving', 'investor-saving', 'restoring'].includes(state)) {
      assert.equal(save.props.disabled, true);
      assert.ok(elements.filter((node) => node.type === 'fieldset').every((node) => node.props.disabled));
      await save.props.onClick();
      await confirm.props.onConfirm();
      await addInvestor.props.onClick();
      modal.props.onClose();
      assert.deepEqual(calls, []);
      assert.deepEqual(states, []);
    } else if (state === 'delete-error') {
      await confirm.props.onConfirm();
      assert.deepEqual(calls, ['delete']);
      assert.ok(states.includes('Brisanje odbijeno'));
      assert.equal(states.at(-1), false);
    } else if (state === 'deleted') {
      await confirm.props.onConfirm();
      assert.deepEqual(calls, ['delete', 'invoices', 'sites', 'investors']);
      assert.ok(states.some((value) => value?.broj === '' && value?.iznos === ''));
      assert.equal(states.filter((value) => value === null).length, 4, 'Clears deletion, editing, inline investor and load error');
      assert.equal(states.at(-1), false);
    } else {
      if (state === 'reload-error') await assert.rejects(history.props.onRestore(), (e) => e.message === 'Investitori nisu dostupni');
      else await history.props.onRestore();
      assert.ok(states.includes(false));
      assert.equal(states.filter((value) => value === null).length, 4, 'Clears editing, inline investor, deletion and load error');
      assert.equal(states.filter((value) => value === '').length, 6, 'Clears site/investor/status/query and both date filters');
      assert.ok(states.some((value) => value?.broj === '' && value?.iznos === ''));
      assert.deepEqual(calls, ['invoices', 'sites', 'investors']);
      if (state === 'reload-error') assert.ok(states.includes('Investitori nisu dostupni'));
    }
  }
});

test('invoice update history keeps lossless pagination, event-only restore and explicit migration and server errors', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.fetchInvoiceChangeHistory('invoice');
  await api.fetchInvoiceChangeHistory('invoice', '9007199254740993');
  await api.restoreInvoiceChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_invoice_change_history', { p_record_id: 'invoice', p_before_sequence: null }],
    ['get_invoice_change_history', { p_record_id: 'invoice', p_before_sequence: '9007199254740993' }],
    ['restore_invoice_change', { p_history_id: 'event' }],
  ]);
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const missing = apiSetup({ error: { code } }).api;
    await assert.rejects(missing.fetchInvoiceChangeHistory('invoice'), /20261110100000/);
    await assert.rejects(missing.restoreInvoiceChange('event'), /20261110100000/);
  }
  for (const code of ['42501', '40001', '23503', 'P0001']) {
    const error = { code, message: 'Rejected' };
    const denied = apiSetup({ error }).api;
    await assert.rejects(denied.fetchInvoiceChangeHistory('invoice'), (reason) => reason === error);
    await assert.rejects(denied.restoreInvoiceChange('event'), (reason) => reason === error);
  }
});

test('invoice update history previews rebate direction and payment dates, checks invoice permissions and warns this is not a credit note', async () => {
  const selected = {
    ...change, operation: 'UPDATE', blocked_reason: null,
    before_data: { broj: 'F-1', kupac: 'Kupac', iznos: 1234.56, rabat: 12.34, rabat_smjer: 'oduzmi',
      status: 'placena', datum_naplate: '2026-11-09', investitor_id: 'investor' },
    after_data: { broj: 'F-2', kupac: 'Novo', iznos: 78.91, rabat: 2.12, rabat_smjer: 'pribroji',
      status: 'izdana', datum_naplate: null, investitor_id: null },
  };
  const button = (ui) => ui.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu'));
  const ui = historyUI({ selected, invoiceHistory: true });
  button(ui).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ui.calls, [['invoice-restore', 'history'], ['invoice-fetch', 'vehicle', undefined], 'refresh-parent']);
  assert.deepEqual(ui.activity, [true, false]);
  assert.match(ui.messages[0], /Iznos: 78,91 → 1\.234,56/);
  assert.match(ui.messages[0], /Rabat: 2,12 → 12,34/);
  assert.match(ui.messages[0], /Smjer rabata: Pribraja se → Oduzima se/);
  assert.match(ui.messages[0], /Status: Izdana → Plaćena/);
  assert.match(ui.messages[0], /Datum naplate: — → 09\.11\.2026\./);
  assert.match(ui.messages[0], /Investitor \(ID\): — → investor/);
  assert.match(ui.messages[0], /ne storno ni ispravak već poslanog računa/);
  assert.match(ui.messages[0], /Ne provodi se bankovna naplata/);
  const denied = historyUI({ canEdit: false });
  assert.equal(denied.invoicePanel({ recordId: 'invoice', onRestore() {} }), null);
  assert.deepEqual(denied.permissions, [['fakture', 'edit']]);
  const panel = historyUI().invoicePanel({ recordId: 'invoice', disabled: true, onRestore() {} });
  assert.equal(panel.props.invoiceHistory, true);
  assert.equal(panel.props.vehicleId, 'invoice');
  assert.equal(panel.props.disabled, true);
  for (const options of [{ disabled: true }, { confirmation: false }, { selected: { ...selected, can_restore: false, blocked_reason: 'Faktura ima noviju promjenu.' } }]) {
    const blocked = historyUI({ selected, invoiceHistory: true, ...options });
    button(blocked).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(blocked.calls, []);
  }
  const failed = historyUI({ selected, invoiceHistory: true, error: { message: 'Faktura ima noviju promjenu' } });
  button(failed).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failed.calls, [['invoice-restore', 'history']]);
  assert.deepEqual(failed.activity, [true, false]);
  assert.ok(failed.states.includes('Faktura ima noviju promjenu'));
});

test('individual cost deletion routes to protected RPCs and keeps errors and history cursors intact', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.deleteTrosak('cost');
  await api.fetchResourceDeletions('troskovi');
  await api.fetchCostDeletions({ id: 'cursor', created_at: '2026-11-09T08:00:00Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['delete_cost_with_history', { p_record_id: 'cost' }],
    ['get_cost_deletions', { p_before_time: null, p_before_id: null }],
    ['get_cost_deletions', { p_before_time: '2026-11-09T08:00:00Z', p_before_id: 'cursor' }],
  ]);
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const missing = apiSetup({ error: { code } }).api;
    await assert.rejects(missing.deleteTrosak('cost'), /20261110070000/);
    await assert.rejects(missing.fetchResourceDeletions('troskovi'), /20261110070000/);
  }
  for (const code of ['42501', '40001', 'P0001']) {
    const error = { code, message: 'Rejected' };
    const denied = apiSetup({ error }).api;
    await assert.rejects(denied.deleteTrosak('cost'), (reason) => reason === error);
    await assert.rejects(denied.fetchCostDeletions(), (reason) => reason === error);
  }
});

test('cost update history keeps lossless pagination, event-only restore and explicit migration and server errors', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.fetchCostChangeHistory('cost');
  await api.fetchCostChangeHistory('cost', '9007199254740993');
  await api.restoreCostChange('event');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['get_cost_change_history', { p_record_id: 'cost', p_before_sequence: null }],
    ['get_cost_change_history', { p_record_id: 'cost', p_before_sequence: '9007199254740993' }],
    ['restore_cost_change', { p_history_id: 'event' }],
  ]);
  for (const code of ['42P01', '42883', 'PGRST202', 'PGRST205']) {
    const missing = apiSetup({ error: { code } }).api;
    await assert.rejects(missing.fetchCostChangeHistory('cost'), /20261110080000/);
    await assert.rejects(missing.restoreCostChange('event'), /20261110080000/);
  }
  for (const code of ['42501', '40001', '23503', 'P0001']) {
    const error = { code, message: 'Rejected' };
    const denied = apiSetup({ error }).api;
    await assert.rejects(denied.fetchCostChangeHistory('cost'), (reason) => reason === error);
    await assert.rejects(denied.restoreCostChange('event'), (reason) => reason === error);
  }
});

test('cost update history previews amounts and payment fields, checks edit permissions and blocks unsafe restores', async () => {
  const selected = {
    ...change, operation: 'UPDATE', blocked_reason: null,
    before_data: { iznos: 1234.56, placen: true, placeno_at: '2026-11-09', opis: 'Izvorno' },
    after_data: { iznos: 78.91, placen: false, placeno_at: null, opis: 'Novo' },
  };
  const button = (ui) => ui.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu'));
  const ui = historyUI({ selected, costHistory: true });
  button(ui).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ui.calls, [['cost-restore', 'history'], ['cost-fetch', 'vehicle', undefined], 'refresh-parent']);
  assert.deepEqual(ui.activity, [true, false]);
  assert.match(ui.messages[0], /Iznos: 78,91 → 1\.234,56/);
  assert.match(ui.messages[0], /Plaćeno: Ne → Da/);
  assert.match(ui.messages[0], /Datum plaćanja: — → 09\.11\.2026\./);
  const denied = historyUI({ canEdit: false });
  assert.equal(denied.costPanel({ recordId: 'cost', onRestore() {} }), null);
  assert.deepEqual(denied.permissions, [['troskovi', 'edit']]);
  const allowed = historyUI();
  const panel = allowed.costPanel({ recordId: 'cost', disabled: true, onRestore() {} });
  assert.equal(panel.props.costHistory, true);
  assert.equal(panel.props.vehicleId, 'cost');
  assert.equal(panel.props.disabled, true);
  for (const options of [{ disabled: true }, { confirmation: false }, { selected: { ...selected, can_restore: false, blocked_reason: 'Potreban je zajednički povrat obračuna.' } }]) {
    const blocked = historyUI({ selected, costHistory: true, ...options });
    button(blocked).props.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(blocked.calls, []);
  }
  const failed = historyUI({ selected, costHistory: true, error: { message: 'Trošak ima noviju promjenu' } });
  button(failed).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failed.calls, [['cost-restore', 'history']]);
  assert.deepEqual(failed.activity, [true, false]);
  assert.ok(failed.states.includes('Trošak ima noviju promjenu'));
});

test('cost recovery previews the exact amount, requires cost edit access and explains unsupported linked records', async () => {
  const selected = {
    id: 'cost', snapshot: { opis: 'Cement', iznos: 1234.56, datum: '2026-11-09', placen: true },
    actor_name: 'Ured', created_at: '2026-11-04T08:00:00Z', expires_at: '2026-12-04T08:00:00Z',
    reversed_at: null, can_restore: true, affected_rows: { troskovi: 1 },
  };
  const ui = deletionUI({ selected, module: 'troskovi' });
  bundleRestoreButton(ui.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ui.calls, [['restore', 'cost'], ['fetch', 'troskovi', undefined], 'refresh-parent']);
  assert.deepEqual(ui.permissions, [['troskovi', 'edit']]);
  assert.deepEqual(ui.activity, [true, false]);
  assert.match(ui.messages[0], /obrisani trošak/);
  assert.match(ui.messages[0], /Cement · 09\.11\.2026\. · 1\.234,56/);
  const denied = deletionUI({ module: 'troskovi', canEdit: false });
  assert.equal(denied.elements.length, 0);
  assert.deepEqual(denied.permissions, [['troskovi', 'edit']]);
  const unsupported = deletionUI({ selected: { ...selected, can_restore: false }, module: 'troskovi' });
  assert.equal(bundleRestoreButton(unsupported.elements).props.disabled, true);
  assert.ok(unsupported.elements.some((node) => String(node.props.children).includes('još nema zajednički povrat')));
  const busy = deletionUI({ selected, module: 'troskovi', disabled: true });
  bundleRestoreButton(busy.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(busy.calls, []);
});

test('cost screen recovery discards drafts and filters, blocks writes and reports linked deletion limitations', async () => {
  for (const state of ['ready', 'saving', 'restoring', 'reload-error', 'delete-error', 'linked']) {
    const calls = [];
    const states = [];
    const Panel = () => null;
    const UpdatePanel = () => null;
    const Modal = () => null;
    const Confirm = () => null;
    const component = load('../src/components/views/TroskoviView.tsx', {
      react: { useState: (initial) => [typeof initial === 'function' ? initial() : initial, (value) => states.push(value)], useEffect() {}, useMemo: (fn) => fn() },
      'react/jsx-runtime': jsxRuntime,
      'lucide-react': new Proxy({}, { get: () => () => null }),
      '@/lib/localization': localization,
      '@/lib/company': { companyStorage: { getItem: () => null }, getUniversalHourlyRate: () => 10 },
      '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory: Panel },
      '@/components/views/FuelChangeHistory': { CostChangeHistoryPanel: UpdatePanel },
      '@/components/ui/Modal': { Modal },
      '@/components/ui/Field': { Field() {}, TextInput() {}, Select() {} },
      '@/components/ui/Badge': { Badge() {} },
      '@/components/ui/ExportMenu': { ExportMenu() {} },
      '@/components/ui/EmptyState': { EmptyState() {} },
      '@/components/ui/ConfirmDialog': { ConfirmDialog: Confirm },
      '@/lib/api': {
        fetchTroskovi: async () => { calls.push('costs'); return []; },
        fetchRadnoVrijeme: async () => { calls.push('hours'); return []; },
        fetchGradilista: async () => { calls.push('sites'); return []; },
        fetchKooperanti: async () => { calls.push('cooperators'); if (state === 'reload-error') throw new Error('Cooperators unavailable'); return []; },
        createTrosak: async () => calls.push('create'),
        updateTrosak: async () => calls.push('update'),
        deleteTrosak: async () => { calls.push('delete'); if (state === 'delete-error') throw { message: 'Brisanje odbijeno' }; },
      },
    }, {
      loading: false, saving: state === 'saving', historyRestoring: state === 'restoring',
      modalOpen: true, editing: { id: 'cost' }, deleteId: 'cost',
      items: [{ id: 'cost', kategorija: 'materijal', opis: 'Cement', datum: '2026-11-09', iznos: 1234.56, nalog_id: state === 'linked' ? 'order' : null }],
      filterGradiliste: 'site', query: 'stari nacrt', filterKat: 'materijal', od: '2026-11-01', doDatuma: '2026-11-30',
      form: { gradiliste_id: 'site', kategorija: 'materijal', opis: 'Nacrt', iznos: '100', datum: '2026-11-09', placen: false },
    });
    const elements = nodes(component.TroskoviView());
    const history = elements.find((node) => node.type === Panel);
    const updates = elements.find((node) => node.type === UpdatePanel);
    assert.equal(updates.props.recordId, 'cost');
    assert.equal(updates.props.disabled, state === 'saving');
    assert.equal(updates.props.onRestore, history.props.onRestore, 'Deletion and update recovery share the exact reset and refresh flow');
    assert.equal(updates.props.onRestoringChange, history.props.onRestoringChange);
    assert.equal(history.props.module, 'troskovi');
    assert.equal(history.props.disabled, state === 'saving');
    const modal = elements.find((node) => node.type === Modal);
    const save = nodes(modal.props.footer).find((node) => node.type === 'button' && node.props.children !== 'Odustani');
    const confirm = elements.find((node) => node.type === Confirm);
    if (['saving', 'restoring'].includes(state)) {
      assert.equal(save.props.disabled, true);
      assert.ok(elements.filter((node) => node.type === 'fieldset').every((node) => node.props.disabled));
      await save.props.onClick();
      await confirm.props.onConfirm();
      modal.props.onClose();
      assert.deepEqual(calls, []);
      assert.deepEqual(states, []);
    } else if (state === 'delete-error') {
      await confirm.props.onConfirm();
      assert.deepEqual(calls, ['delete']);
      assert.ok(states.includes('Brisanje odbijeno'));
    } else if (state === 'linked') {
      assert.match(confirm.props.message, /Samostalni povrat ove stavke još nije podržan/);
    } else {
      assert.match(confirm.props.message, /30 dana/);
      if (state === 'reload-error') await assert.rejects(history.props.onRestore(), /Cooperators unavailable/);
      else await history.props.onRestore();
      assert.ok(states.includes(false));
      assert.equal(states.filter((value) => value === null).length, 3, 'Clears editing, deletion and prior error');
      assert.equal(states.filter((value) => value === '').length, 5, 'Clears site/category/query and both date filters');
      assert.ok(states.some((value) => value?.opis === '' && value?.iznos === ''));
      assert.deepEqual(calls, ['costs', 'hours', 'sites', 'cooperators']);
    }
  }
});

test('work-order cost sync atomically replaces hours and operating costs, including empty results', async () => {
  for (const withHours of [true, false]) {
    const calls = [];
    const stop = { code: '40001', message: 'Replacement rejected' };
    const api = load('../src/lib/api.ts', {
      './supabase': { supabase: {
        rpc: async (name, payload) => {
          assert.equal(name, 'replace_work_order_settlement');
          calls.push(JSON.parse(JSON.stringify(payload)));
          return { error: calls.length === 2 ? stop : null };
        },
        from: (table) => {
          assert.notEqual(table, 'radno_vrijeme', 'Never split hour replacement into direct DELETE and INSERT');
          const result = () => ({
            error: null,
            data: table === 'radni_nalozi'
              ? { status: 'zavrsen', bez_troska: true, datum_kreiranja: '2026-11-09', broj: 'RN-1' }
              : table === 'radni_nalozi_radnici' && withHours ? [{
                radnik_id: 'worker', vrijeme_od: '08:00', vrijeme_do: '16:00',
                radnik: { ime: 'Ana', prezime: 'Test', cijena_sata: 10 },
              }] : [],
          });
          const query = {
            select: () => query, eq: () => query, order: () => query, delete: () => query,
            update: () => query, not: () => query, single: async () => result(),
            then: (resolve) => Promise.resolve(result()).then(resolve),
          };
          return query;
        },
      } },
      './postavke': { nocniInterval: () => ({}) },
      './obracunSati': { minuteSmjene: () => ({ ukupno: 480, nocne: 120 }) },
      './vehicleKmCosts': {}, './company': {}, './pagination': {}, './rokovi': {}, './imageCompression': {},
    });
    await assert.rejects(api.syncNalogTroskovi('order'), (reason) => reason === stop);
    assert.deepEqual(calls, [
      { p_nalog_id: 'order', p_entries: [], p_costs: [] },
      { p_nalog_id: 'order', p_entries: withHours ? [{
        radnik_id: 'worker', gradiliste_id: null, datum: '2026-11-09', sati: 8,
        napomena: 'Ostalo: RN-1 (bez troška) · Noćni rad 2 h', nalog_id: 'order', nocni_sati: 2,
      }] : [], p_costs: [] },
    ]);
  }
});

test('work-time history shows the worker and exact hours, enforces edit rights and locks concurrent mutations', async () => {
  const selected = {
    id: 'hours-deletion', snapshot: { radnik_id: 'worker', datum: '2026-11-09', sati: 7.5, nocni_sati: 2.5 },
    actor_name: 'Ured', created_at: '2026-11-09T08:00:00Z', expires_at: '2026-12-09T08:00:00Z',
    reversed_at: null, can_restore: true, affected_rows: { radno_vrijeme: 1 },
  };
  const ui = deletionUI({ module: 'radno_vrijeme', selected, workerNames: { worker: 'Ana Test' } });
  bundleRestoreButton(ui.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ui.calls, [['restore', 'hours-deletion'], ['fetch', 'radno_vrijeme', undefined], 'refresh-parent']);
  assert.deepEqual(ui.activity, [true, false]);
  assert.deepEqual(ui.permissions, [['radno_vrijeme', 'edit']]);
  assert.match(ui.messages[0], /Ana Test · 09\.11\.2026\. · 7,5 h/);
  assert.ok(ui.elements.some((node) => String(node.props.children).includes('Pojedinačno obrisano radno vrijeme')));
  const busy = deletionUI({ module: 'radno_vrijeme', selected, disabled: true });
  const button = bundleRestoreButton(busy.elements);
  assert.equal(button.props.disabled, true);
  button.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(busy.calls, []);
  const blocked = deletionUI({ module: 'radno_vrijeme', selected: { ...selected, can_restore: false } });
  assert.equal(bundleRestoreButton(blocked.elements).props.disabled, true);
  assert.ok(blocked.elements.some((node) => String(node.props.children).includes('nalog, ekipa ili sati naloga')));
  const denied = deletionUI({ module: 'radno_vrijeme', canEdit: false });
  assert.equal(denied.elements.length, 0);
  assert.deepEqual(denied.permissions, [['radno_vrijeme', 'edit']]);
  const failed = deletionUI({ module: 'radno_vrijeme', selected, restoreError: { message: 'Sati su ponovno obračunati' } });
  bundleRestoreButton(failed.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failed.activity, [true, false]);
  assert.deepEqual(failed.calls, [['restore', 'hours-deletion']]);
});

test('work-time recovery closes stale editors, clears filters and selections, reloads and blocks competing saves', async () => {
  for (const state of ['ready', 'saving', 'restoring', 'reload-error']) {
    const calls = [];
    const states = [];
    const Panel = () => null;
    const ChangePanel = () => null;
    const Modal = () => null;
    const Confirm = () => null;
    const component = load('../src/components/views/RadnoVrijemeView.tsx', {
      react: { useState: (value) => [value, (next) => states.push(next)], useEffect() {} },
      'react/jsx-runtime': jsxRuntime,
      'lucide-react': { Clock() {}, Plus() {}, Pencil() {}, Trash2() {}, Calendar() {} },
      '@/lib/localization': localization,
      '@/auth/useAuth': { useAuth: () => ({ canAccess: () => true }) },
      '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory: Panel },
      '@/components/views/FuelChangeHistory': { WorkTimeChangeHistoryPanel: ChangePanel },
      '@/components/ui/Badge': { Badge() {} },
      '@/components/ui/Modal': { Modal },
      '@/components/ui/Field': { Field() {}, TextInput() {}, Select() {}, Textarea() {} },
      '@/components/ui/ConfirmDialog': { ConfirmDialog: Confirm },
      '@/components/ui/EmptyState': { EmptyState() {} },
      './ObracunSatiPanel': { ObracunSatiPanel() {} },
      '@/lib/api': {
        fetchRadnoVrijeme: async () => { calls.push('hours'); if (state === 'reload-error') throw new Error('Load failed'); return []; },
        fetchGradilista: async () => { calls.push('sites'); return []; },
        fetchRadnici: async () => { calls.push('workers'); return []; },
        updateRadnoVrijeme: async () => calls.push('save'),
        deleteRadnoVrijeme: async () => calls.push('delete'),
      },
    }, {
      loading: false, saving: state === 'saving', historyRestoring: state === 'restoring',
      modalOpen: true, editing: { id: 'hours' }, deleteId: 'hours', filterDatum: '2026-11-09',
      radnici: [{ id: 'worker', ime: 'Ana', prezime: 'Test' }],
      form: { radnik_id: 'worker', gradiliste_id: '', datum: '2026-11-09', sati: '8', nocni_sati: '0', napomena: 'Nacrt' },
    });
    const elements = nodes(component.RadnoVrijemeView());
    const history = elements.find((node) => node.type === Panel);
    assert.equal(history.props.module, 'radno_vrijeme');
    assert.equal(history.props.disabled, state === 'saving');
    assert.equal(history.props.workerNames.worker, 'Ana Test');
    const updateHistory = elements.find((node) => node.type === ChangePanel);
    assert.equal(updateHistory.props.recordId, 'hours');
    assert.equal(updateHistory.props.disabled, state === 'saving');
    assert.equal(updateHistory.props.onRestore, history.props.onRestore, 'Both recovery paths discard stale forms and reload');
    assert.equal(updateHistory.props.onRestoringChange, history.props.onRestoringChange);
    const modal = elements.find((node) => node.type === Modal);
    const save = nodes(modal.props.footer).find((node) => node.type === 'button' && node.props.children !== 'Odustani');
    if (state === 'saving' || state === 'restoring') {
      assert.equal(save.props.disabled, true);
      assert.ok(elements.filter((node) => node.type === 'fieldset').every((node) => node.props.disabled));
      await save.props.onClick();
      await elements.find((node) => node.type === Confirm).props.onConfirm();
      modal.props.onClose();
      assert.deepEqual(calls, []);
      assert.deepEqual(states, []);
    } else {
      if (state === 'reload-error') await assert.rejects(history.props.onRestore(), /Load failed/);
      else await history.props.onRestore();
      assert.ok(states.includes(false), 'Closes the editor');
      assert.ok(states.includes(null), 'Clears editing/deletion selections');
      assert.ok(states.includes(''), 'Clears the date filter');
      assert.ok(states.some((value) => value?.radnik_id === '' && value?.napomena === ''), 'Discards the stale draft');
      assert.deepEqual(calls, ['hours', 'sites', 'workers']);
    }
  }
});

test('site deletion history names dependent records and uses only the operation ID for recovery', async () => {
  const ui = deletionUI({ module: 'gradilista', selected: {
    id: 'site-deletion', snapshot: { naziv: 'Testno gradilište' }, actor_name: 'Admin',
    created_at: '2026-11-04T10:00:00Z', expires_at: '2026-12-04T10:00:00Z',
    reversed_at: null, can_restore: true,
    affected_rows: { gradilista: 1, fakture: 2, gradiliste_board_layout: 1, gradiliste_dokumenti: 3 },
  } });
  assert.ok(ui.elements.some((node) => [].concat(node.props.children).includes('Obrisana gradilišta i povezani podaci (30 dana)')));
  bundleRestoreButton(ui.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(ui.messages[0], /obrisano gradilište "Testno gradilište"/);
  assert.match(ui.messages[0], /Fakture: 2/);
  assert.match(ui.messages[0], /Položaj gradilišta na ploči: 1/);
  assert.deepEqual(ui.calls, [['restore', 'site-deletion'], ['fetch', 'gradilista', undefined], 'refresh-parent']);
  assert.equal(deletionUI({ module: 'gradilista', canEdit: false }).elements.length, 0);
});

test('work-order recovery confirms number and title and calls only the protected operation ID', async () => {
  const ui = deletionUI({ module: 'radni_nalozi', selected: {
    id: 'order-deletion', snapshot: { broj: 'RN-1', naslov: 'Završeni nalog' }, actor_name: 'Admin',
    created_at: '2026-11-04T10:00:00Z', expires_at: '2026-12-04T10:00:00Z',
    reversed_at: null, can_restore: true,
    affected_rows: { radni_nalozi: 1, radno_vrijeme: 2, troskovi: 3, radni_nalozi_stavke: 4 },
  } });
  assert.ok(ui.elements.some((node) => [].concat(node.props.children).includes('Obrisani radni nalozi i povezani podaci (30 dana)')));
  bundleRestoreButton(ui.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(ui.messages[0], /obrisani radni nalog "RN-1 · Završeni nalog"/);
  assert.match(ui.messages[0], /Troškovi: 3/);
  assert.deepEqual(ui.calls, [['restore', 'order-deletion'], ['fetch', 'radni_nalozi', undefined], 'refresh-parent']);
  assert.equal(deletionUI({ module: 'radni_nalozi', canEdit: false }).elements.length, 0);
});

test('individual task deletion uses protected RPC and separate lossless history pagination', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.deleteGradilisteZadatak('task');
  await api.fetchTaskDeletions();
  await api.fetchTaskDeletions({ id: 'cursor', created_at: '2026-11-04T10:00:00Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['delete_resource_with_history', { p_table: 'gradiliste_zadaci', p_record_id: 'task' }],
    ['get_task_deletions', { p_before_time: null, p_before_id: null }],
    ['get_task_deletions', { p_before_time: '2026-11-04T10:00:00Z', p_before_id: 'cursor' }],
  ]);
  for (const code of ['22023', 'PGRST202']) {
    await assert.rejects(apiSetup({ error: { code } }).api.deleteGradilisteZadatak('task'), /20261110010000/);
    await assert.rejects(apiSetup({ error: { code } }).api.fetchTaskDeletions(), /20261110010000/);
  }
  const denied = { code: '42501', message: 'Denied' };
  await assert.rejects(apiSetup({ error: denied }).api.deleteGradilisteZadatak('task'), (reason) => reason === denied);
  await assert.rejects(apiSetup({ error: denied }).api.fetchTaskDeletions(), (reason) => reason === denied);
});

test('task recovery previews cascaded deadlines and refreshes the task list rather than deleted sites', async () => {
  const ui = deletionUI({ module: 'gradilista', table: 'gradiliste_zadaci', selected: {
    id: 'task-deletion', snapshot: { naziv: 'Dodatni rad' }, actor_name: 'Admin',
    created_at: '2026-11-04T10:00:00Z', expires_at: '2026-12-04T10:00:00Z',
    reversed_at: null, can_restore: true, affected_rows: { gradiliste_zadaci: 1, rokovi: 2 },
  } });
  assert.ok(ui.elements.some((node) => [].concat(node.props.children).includes('Obrisani zadaci i dodatni radovi (30 dana)')));
  bundleRestoreButton(ui.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(ui.messages[0], /obrisani zadatak "Dodatni rad"/);
  assert.match(ui.messages[0], /Rokovi: 2/);
  assert.deepEqual(ui.calls, [['restore', 'task-deletion'], ['fetch-tasks', undefined], 'refresh-parent']);
  assert.equal(deletionUI({ module: 'gradilista', table: 'gradiliste_zadaci', canEdit: false }).elements.length, 0);
  assert.deepEqual(deletionUI({ module: 'radni_nalozi', table: 'gradiliste_zadaci', canEdit: false }).permissions, [['gradilista', 'edit']]);
});

test('deadline deletion and lossless pagination use only protected RPC parameters', async () => {
  const { api, calls } = apiSetup({ data: [], error: null });
  await api.deleteRok('deadline');
  await api.fetchDeadlineDeletions();
  await api.fetchDeadlineDeletions({ id: 'cursor', created_at: '2026-11-04T10:00:00Z' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['delete_resource_with_history', { p_table: 'rokovi', p_record_id: 'deadline' }],
    ['get_deadline_deletions', { p_before_time: null, p_before_id: null }],
    ['get_deadline_deletions', { p_before_time: '2026-11-04T10:00:00Z', p_before_id: 'cursor' }],
  ]);
  for (const code of ['22023', 'PGRST202']) {
    await assert.rejects(apiSetup({ error: { code } }).api.deleteRok('deadline'), /20261110020000/);
    await assert.rejects(apiSetup({ error: { code } }).api.fetchDeadlineDeletions(), /20261110020000/);
  }
  const denied = { code: '42501', message: 'Denied' };
  await assert.rejects(apiSetup({ error: denied }).api.deleteRok('deadline'), (reason) => reason === denied);
  await assert.rejects(apiSetup({ error: denied }).api.fetchDeadlineDeletions(), (reason) => reason === denied);
});

test('deadline recovery routes to its own history and confirms the task conflict protection', async () => {
  const ui = deletionUI({ module: 'gradilista', table: 'rokovi', selected: {
    id: 'deadline-deletion', snapshot: { naziv: 'Predaja radova', datum_pocetka: '2026-11-04', datum_zavrsetka: '2026-11-09' }, actor_name: 'Admin',
    created_at: '2026-11-04T10:00:00Z', expires_at: '2026-12-04T10:00:00Z',
    reversed_at: null, can_restore: true, affected_rows: { rokovi: 1 },
  } });
  assert.ok(ui.elements.some((node) => [].concat(node.props.children).includes('Pojedinačno obrisani rokovi (30 dana)')));
  assert.ok(ui.elements.some((node) => typeof node.props.children === 'string' && /njegovi rokovi nisu naknadno/.test(node.props.children)));
  bundleRestoreButton(ui.elements).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(ui.messages[0], /obrisani rok "Predaja radova"/);
  assert.match(ui.messages[0], /Rokovi: 1/);
  assert.match(ui.messages[0], /04\.11\.2026\. – 09\.11\.2026\./);
  assert.deepEqual(ui.calls, [['restore', 'deadline-deletion'], ['fetch-deadlines', undefined], 'refresh-parent']);
  assert.deepEqual(deletionUI({ module: 'radni_nalozi', table: 'rokovi', canEdit: false }).permissions, [['gradilista', 'edit']]);
});

test('task updates rely on the atomic database projection, without a second write or swallowed errors', async () => {
  for (const error of [null, { code: '42501', message: 'Denied' }, { code: 'PGRST202', message: 'Missing RPC' }]) {
    const calls = [];
    const api = load('../src/lib/api.ts', {
      './supabase': { supabase: {
        from: (table) => ({
          update: (payload) => ({ eq: (_, id) => ({ select: () => ({ single: async () => {
            calls.push([table, id, payload]);
            return { data: { id, naziv: 'Novi naziv', rok: '2026-11-09' }, error };
          } }) }) }),
        }),
        rpc: async (...args) => { calls.push(args); return { error }; },
      } },
      './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
      './pagination': {}, './rokovi': {}, './imageCompression': {},
    });
    const action = api.updateGradilisteZadatak('task', { naziv: 'Novi naziv' });
    if (error) await assert.rejects(action, (reason) => reason === error);
    else await action;
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
      ['gradiliste_zadaci', 'task', { naziv: 'Novi naziv' }],
    ]);
  }
});

test('task creation sends its deadline in the same write and preserves the returned task', async () => {
  for (const error of [null, { message: 'Povezani rok nije točno spremljen.' }]) {
    const calls = [];
    const record = { id: 'task', naziv: 'Posao', rok: '2026-11-09' };
    const api = load('../src/lib/api.ts', {
      './supabase': { supabase: {
        from: (table) => ({
          insert: (payload) => ({ select: () => ({ single: async () => {
            calls.push([table, payload]); return { data: record, error };
          } }) }),
        }),
        rpc: () => { assert.fail('A second synchronization request is not atomic'); },
      } },
      './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
      './pagination': {}, './rokovi': {}, './imageCompression': {},
    });
    const action = api.createGradilisteZadatak('site', 'Posao', '2026-11-09', 'dodatni', 'contractor');
    if (error) await assert.rejects(action, (reason) => reason === error);
    else assert.equal(await action, record);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['gradiliste_zadaci', {
      gradiliste_id: 'site', naziv: 'Posao', rok: '2026-11-09', vrsta: 'dodatni', kooperant_id: 'contractor',
    }]]);
  }
});

test('timeline exposes deadline recovery and clears stale editor and filters before reloading all timeline sources', async () => {
  const states = [];
  const calls = [];
  const Panel = () => null;
  const component = load('../src/components/views/TerminskiPlanView.tsx', {
    react: {
      useState: (value) => [typeof value === 'function' ? value() : value, (next) => states.push(next)],
      useEffect() {}, useMemo: (fn) => fn(), useRef: (current) => ({ current }),
    },
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': { AlertCircle() {}, CalendarDays() {}, ChevronDown() {}, ChevronLeft() {}, ChevronRight() {}, Clock3() {}, FileDown() {}, Pencil() {}, Plus() {}, RefreshCw() {} },
    '@/lib/localization': localization,
    '@/auth/useAuth': { useAuth: () => ({ canAccess: () => true }) },
    '@/lib/api': Object.fromEntries([
      ['fetchGradilista', 'sites'], ['fetchRokovi', 'deadlines'], ['fetchTerminskiPlanZadaci', 'tasks'],
      ['fetchKooperantAngazmani', 'engagements'], ['fetchKooperanti', 'contractors'],
    ].map(([name, label]) => [name, async () => { calls.push(label); return []; }])),
    '@/lib/terminskiPlanPdf': {},
    '@/lib/obracunSati': { hrPraznici: () => new Map() },
    '@/components/ui/Modal': { Modal() {} },
    '@/components/ui/Field': { Field() {}, Select() {}, Textarea() {}, TextInput() {} },
    '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory: Panel },
    '@/components/views/FuelChangeHistory': { DeadlineChangeHistoryPanel() {} },
  }, { loading: false, deadlineModalOpen: true, editingDeadline: { id: 'old-deadline' }, selectedSite: 'old-site', statusFilter: 'otvoreni' });
  const panel = nodes(component.TerminskiPlanView({ onOpenGradiliste() {} })).find((node) => node.type === Panel);
  assert.equal(panel.props.table, 'rokovi');
  assert.equal(panel.props.module, 'gradilista');
  await panel.props.onRestore();
  assert.ok(states.includes(false));
  assert.ok(states.includes(null));
  assert.ok(states.includes('svi'));
  assert.ok(states.includes(''));
  assert.ok(states.some((value) => value?.naziv === ''), 'Discard stale deadline draft');
  assert.deepEqual(calls, ['sites', 'deadlines', 'tasks', 'engagements', 'contractors']);
});

test('failed schedule linking uses protected cleanup and explicitly reports a remaining order if cleanup is denied', async () => {
  for (const cleanupError of [null, { message: 'Cleanup denied', code: '42501' }]) {
    const calls = [];
    const api = load('../src/lib/api.ts', {
      './supabase': { supabase: {
        from: (table) => {
          if (table === 'radni_nalozi') return {
            insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'order', broj: 'RN-1' }, error: null }) }) }),
          };
          assert.equal(table, 'dnevni_raspored_gradilista');
          return { update: () => ({ eq: async () => ({ error: { message: 'Link failed' } }) }) };
        },
        rpc: async (...args) => { calls.push(args); return { error: cleanupError }; },
      } },
      './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
      './pagination': {}, './rokovi': {}, './imageCompression': {},
    });
    await assert.rejects(api.createNalogFromRaspored('assignment', {
      gradiliste_id: null, radnik_ids: [], broj: 'RN-1',
    }), cleanupError ? /Nalog RN-1 \(order\) ostaje.*Cleanup denied/ : (reason) => reason.message === 'Link failed');
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['delete_resource_with_history', { p_table: 'radni_nalozi', p_record_id: 'order' }]]);
  }
});

test('work-order deadlines expose update recovery and lock competing writes while restoring', async () => {
  for (const busy of [false, true]) {
    const calls = [];
    const states = [];
    const Panel = () => null;
    const component = load('../src/components/views/RadniNaloziView.tsx', {
      react: { useState: (value) => [value, (next) => states.push(next)], useEffect() {}, useCallback: (fn) => fn },
      'react/jsx-runtime': jsxRuntime,
      'lucide-react': new Proxy({}, { get: () => () => null }),
      '@/lib/localization': localization,
      '@/lib/useRequestScope': { useRequestScope: () => ({ start: () => () => true, invalidate() {} }) },
      '@/lib/api': {
        fetchRokoviNaloga: async () => { calls.push('deadlines'); return []; },
        updateRok: async (...args) => { calls.push(['update', ...args]); },
      },
      '@/components/ui/Badge': { Badge() {} },
      '@/components/ui/Modal': { Modal() {} },
      '@/components/ui/Field': { Field() {}, TextInput() {}, Select() {}, Textarea() {} },
      '@/components/ui/ConfirmDialog': { ConfirmDialog() {} },
      '@/components/ui/EmptyState': { EmptyState() {} },
      './NalogIzvrsenje': { NalogIzvrsenje() {} },
      '@/components/ui/ExportMenu': { ExportMenu() {} },
      '@/lib/nalogPdf': {},
      '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory() {} },
      '@/components/views/FuelChangeHistory': { DeadlineChangeHistoryPanel: Panel },
      '@/components/views/ContractedWorkHistory': { OrderHistory() {} },
    }, {
      loading: false, period: 'svi', deadlineRestoring: busy,
      items: [{ id: 'order', status: 'otvoren', prioritet: 'srednji', broj: 'RN-1', naslov: 'Nalog' }],
      rokovi: [{ id: 'deadline', nalog_id: 'order', naziv: 'Predaja', datum: '2026-11-09', status: 'otvoren' }],
    });
    const elements = nodes(component.RadniNaloziView());
    const panel = elements.find((node) => node.type === Panel);
    assert.equal(panel.props.recordId, 'deadline');
    assert.equal(panel.props.disabled, busy);
    const checkbox = elements.find((node) => node.type === 'input' && node.props.title === 'Označi kao završeno');
    checkbox.props.onChange();
    await new Promise((resolve) => setImmediate(resolve));
    if (busy) {
      assert.deepEqual(calls, []);
      assert.ok(elements.some((node) => node.type === 'fieldset' && node.props.disabled));
    } else {
      assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['update', 'deadline', { status: 'zavrsen' }], 'deadlines']);
      calls.length = 0;
      await panel.props.onRestore();
      assert.deepEqual(calls, ['deadlines']);
      assert.ok(states.some((value) => value?.naziv === '' && value?.datum === ''), 'Discard unsaved new deadline');
    }
  }
});

test('work-order screen resets editor, selection and filters and reloads after bundle recovery', async () => {
  for(const state of ['ready','saving','modal','restoring','deadline-saving','deadline-restoring','notifying','reload-error','deadline-error']) {
  const states = [];
  const calls = [];
  const DeletionPanel = () => null;
  const UpdatePanel = () => null;
  const component = load('../src/components/views/RadniNaloziView.tsx', {
    react: {
      useState: (value) => [value, (next) => states.push(next)],
      useEffect() {}, useCallback: (fn) => fn,
    },
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': { ClipboardList() {}, Plus() {}, Pencil() {}, Trash2() {}, Users() {}, Calendar() {}, AlertCircle() {}, Printer() {}, Bell() {}, History() {} },
    '@/lib/localization': localization,
    '@/lib/useRequestScope': { useRequestScope: () => ({ start: () => () => true, invalidate() {} }) },
    '@/lib/api': {
      fetchRokoviNaloga: async () => { calls.push('deadlines'); if(state==='deadline-error')throw {message:'Rokovi nisu dostupni'}; return []; },
      fetchRadniNalozi: async () => { calls.push('orders'); if(state==='reload-error')throw {message:'Nalozi nisu dostupni'}; return []; },
      fetchGradilista: async () => { calls.push('sites'); return []; },
      fetchRadnici: async () => { calls.push('workers'); return []; },
    },
    '@/components/ui/Badge': { Badge() {} },
    '@/components/ui/Modal': { Modal() {} },
    '@/components/ui/Field': { Field() {}, TextInput() {}, Select() {}, Textarea() {} },
    '@/components/ui/ConfirmDialog': { ConfirmDialog() {} },
    '@/components/ui/EmptyState': { EmptyState() {} },
    './NalogIzvrsenje': { NalogIzvrsenje() {} },
    '@/components/ui/ExportMenu': { ExportMenu() {} },
    '@/lib/nalogPdf': {},
    '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory: DeletionPanel },
    '@/components/views/FuelChangeHistory': { DeadlineChangeHistoryPanel() {} },
    '@/components/views/ContractedWorkHistory': { OrderHistory: UpdatePanel },
  }, { loading: false, editing: { id: 'order', radnici: [] }, modalOpen: state==='modal', showHistory: true, search: 'old',
    saving:state==='saving',historyRestoring:state==='restoring',rokSaving:state==='deadline-saving',
    deadlineRestoring:state==='deadline-restoring',notifyingId:state==='notifying'?'order':null });
  const elements = nodes(component.RadniNaloziView());
  const history = elements.find((node) => node.type === DeletionPanel);
  const taskHistory = elements.find((node) => node.type === DeletionPanel && node.props.table === 'gradiliste_zadaci');
  const deadlineHistory = elements.find((node) => node.type === DeletionPanel && node.props.table === 'rokovi');
  const updates=elements.find(node=>node.type===UpdatePanel);
  assert.equal(updates.props.onRestore,history.props.onRestore);
  assert.equal(updates.props.onRestoringChange,history.props.onRestoringChange);
  assert.equal(updates.props.disabled,['saving','modal','restoring','deadline-saving','deadline-restoring','notifying'].includes(state));
  assert.equal(history.props.disabled,updates.props.disabled);
  updates.props.onRestoringChange(true);
  assert.ok(states.includes(true));
  if(state==='restoring')assert.ok(elements.some(node=>node.type==='fieldset'&&node.props.disabled));
  assert.equal(deadlineHistory.props.onRestore, history.props.onRestore, 'Deadline restore also clears stale order drafts and filters');
  assert.equal(taskHistory.props.module, 'gradilista');
  assert.equal(taskHistory.props.onRestore, history.props.onRestore, 'Task restore also discards order drafts and filters');
  assert.equal(history.props.module, 'radni_nalozi');
  if(state==='reload-error'||state==='deadline-error'){
    await assert.rejects(updates.props.onRestore(),reason=>reason.message.includes('nisu dostupni'));
    assert.ok(states.some(value=>typeof value==='string'&&value.includes('nisu dostupni')));
    continue;
  }
  await updates.props.onRestore();
  assert.ok(states.includes(false));
  assert.ok(states.includes(null));
  assert.ok(states.includes('svi'));
  assert.ok(states.includes(''));
  assert.ok(states.some((value) => value?.naslov === ''), 'Discards stale order draft');
  assert.deepEqual(calls, ['orders', 'sites', 'workers', 'deadlines']);
  assert.equal(states.filter(value=>value===true).length,1,'Strict reload must not set page loading and unmount the active history');
  }
});

test('deleting site/order documents and photos retains original files and thumbnails and propagates row errors', async () => {
  for (const method of ['deleteGradilisteDokument', 'deleteNalogDokument', 'deleteNalogFoto']) {
    const calls = [];
    let error = null;
    const api = load('../src/lib/api.ts', {
      './supabase': { supabase: {
        from: (table) => ({ delete: () => ({ eq: async (_, id) => { calls.push([table, id]); return { error }; } }) }),
        storage: { from: () => { assert.fail('Previously referenced files must be retained'); } },
      } },
      './postavke': {}, './obracunSati': {}, './vehicleKmCosts': {}, './company': {},
      './pagination': {}, './rokovi': {}, './imageCompression': {},
    });

    await api[method]({ id: 'document', putanja: 'original.webp', thumbnail_path: 'thumb.webp' });
    assert.equal(calls.length, 1);
    error = { code: '42501', message: 'Denied' };
    await assert.rejects(api[method]({ id: 'document' }), (reason) => reason === error);
  }
});

    test('deadline update history scopes sequence cursors and restores only an event ID', async () => {
      const { api, calls } = apiSetup({ data: [], error: null });
      await api.fetchDeadlineChangeHistory('deadline');
      await api.fetchDeadlineChangeHistory('deadline', '9007199254740993');
      await api.restoreDeadlineChange('event');
      assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
        ['get_deadline_change_history', { p_record_id: 'deadline', p_before_sequence: null }],
        ['get_deadline_change_history', { p_record_id: 'deadline', p_before_sequence: '9007199254740993' }],
        ['restore_deadline_change', { p_history_id: 'event' }],
      ]);
      for (const code of ['42501', '40001', 'P0001']) {
        const error = { code, message: 'Rejected' };
        const denied = apiSetup({ error }).api;
        await assert.rejects(denied.fetchDeadlineChangeHistory('deadline'), (reason) => reason === error);
        await assert.rejects(denied.restoreDeadlineChange('event'), (reason) => reason === error);
      }
      const missing = apiSetup({ error: { code: 'PGRST202' } }).api;
      await assert.rejects(missing.fetchDeadlineChangeHistory('deadline'), /20261110030000/);
      await assert.rejects(missing.restoreDeadlineChange('event'), /20261110030000/);
    });

    test('deadline update history renders Croatian fields, uses its own RPC and obeys editor locks and permissions', async () => {
      const selected = {
        ...change, operation: 'UPDATE', blocked_reason: null,
        before_data: { naziv: 'Predaja', datum: '2026-11-09', status: 'otvoren', kooperant_id: null },
        after_data: { naziv: 'Primopredaja', datum: '2026-11-10', status: 'zavrsen', kooperant_id: 'cooperator' },
      };
      const ui = historyUI({ selected, deadlineHistory: true });
      ui.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.onClick();
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(ui.calls, [['deadline-restore', 'history'], ['deadline-fetch', 'vehicle', undefined], 'refresh-parent']);
      assert.match(ui.messages[0], /Status: Završen → Otvoren/);
      assert.match(ui.messages[0], /Datum: 10\.11\.2026\. → 09\.11\.2026\./);
      assert.match(ui.messages[0], /Kooperant \(ID\): cooperator → —/);
      assert.deepEqual(ui.activity, [true, false]);
      const busy = historyUI({ selected, deadlineHistory: true, disabled: true });
      const button = busy.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu'));
      assert.equal(button.props.disabled, true);
      await button.props.onClick();
      assert.deepEqual(busy.calls, []);
      const linked = historyUI({ deadlineHistory: true, selected: { ...selected, can_restore: false, blocked_reason: 'Rok održava povezani zadatak.' } });
      assert.ok(linked.elements.some((node) => node.props.children === 'Rok održava povezani zadatak.'));
      assert.equal(linked.elements.find((node) => node.type === 'button' && node.props.children?.includes('Vrati promjenu')).props.disabled, true);
      const denied = historyUI({ canEdit: false });
      assert.equal(denied.deadlinePanel({ recordId: 'deadline', onRestore() {} }), null);
      assert.deepEqual(denied.permissions, [['gradilista', 'edit']]);
    });

    test('both deadline editors lock saving and closing during undo and discard stale drafts on success', async () => {
      for (const owner of ['site', 'timeline']) {
        for (const state of ['ready', 'saving', 'restoring']) {
          const states = [];
          const calls = [];
          const Panel = () => null;
          const Modal = () => null;
          const sharedMocks = {
            react: {
              useState: (value) => [typeof value === 'function' ? value() : value, (next) => states.push(next)],
              useEffect() {}, useMemo: (fn) => fn(), useRef: (current) => ({ current }),
              useCallback: (fn) => fn,
            },
            'react/jsx-runtime': jsxRuntime,
            'lucide-react': new Proxy({}, { get: () => () => null }),
            '@/lib/localization': localization,
            '@/auth/useAuth': { useAuth: () => ({ canAccess: () => true }) },
            '@/lib/api': {
              fetchFullRekapitulacija: async () => { calls.push('site-details'); return {}; },
              ...Object.fromEntries(['fetchGradilista', 'fetchRokovi', 'fetchTerminskiPlanZadaci', 'fetchKooperantAngazmani', 'fetchKooperanti']
                .map((name) => [name, async () => { calls.push(name); return []; }])),
            },
            '@/components/ui/Modal': { Modal },
            '@/components/ui/Field': { Field() {}, Select() {}, Textarea() {}, TextInput() {} },
            '@/components/views/FuelChangeHistory': { DeadlineChangeHistoryPanel: Panel },
          };
          const mocks = owner === 'site' ? {
            ...sharedMocks,
            '@/lib/useDeferredFiles': { useDeferredFiles: () => ({ data: [], setData() {}, loading: false, error: null, refresh() {} }) },
            '@/lib/company': { companyStorage: { getItem: () => null }, getUniversalHourlyRate: () => 10 },
            '@/lib/downloadFile': {}, '@/types': {},
            '@/lib/ponude': {},
            '@/lib/useOverviewLayout': { useOverviewLayout: () => false },
            '@/components/ui/Badge': { Badge() {} },
            '@/components/ui/ConfirmDialog': { ConfirmDialog() {} },
            '@/components/views/GradilisteMaterijalDokumenti': { GradilisteMaterijalDokumenti() {} },
            '@/components/views/GradilisteTroskovnik': { GradilisteTroskovnik() {} },
          } : {
            ...sharedMocks,
            '@/lib/terminskiPlanPdf': {},
            '@/lib/obracunSati': { hrPraznici: () => new Map() },
            '@/components/views/ResourceDeletionHistory': { ResourceDeletionHistory() {} },
          };
          const file = owner === 'site' ? '../src/components/views/GradilisteDetailsPanel.tsx' : '../src/components/views/TerminskiPlanView.tsx';
          const component = load(file, mocks, {
            deadlineModalOpen: true, editingDeadline: { id: 'deadline' },
            savingDeadline: state === 'saving', deadlineRestoring: state === 'restoring',
          });
          const tree = owner === 'site'
            ? component.GradilisteDetailsPanel({ gradiliste: { id: 'site', naziv: 'Gradilište', status: 'aktivno' }, onRokoviChange: () => calls.push('parent') })
            : component.TerminskiPlanView({ onOpenGradiliste() {} });
          const elements = nodes(tree);
          elements.push(...elements.filter((node) => node.props.footer).flatMap((node) => nodes(node.props.footer)));
          const history = elements.find((node) => node.type === Panel);
          assert.equal(history.props.recordId, 'deadline');
          assert.equal(history.props.disabled, state === 'saving');
          const modal = elements.find((node) => node.type === Modal && /Uredi (rok|termin)/.test(node.props.title));
          const form = nodes(modal.props.children).find((node) => node.type === 'fieldset');
          assert.equal(form.props.disabled, state !== 'ready');
          if (state !== 'ready') {
            const save = nodes(modal.props.footer).find((node) => node.type === 'button' && node.props.children !== 'Odustani');
            assert.equal(save.props.disabled, true);
            await save.props.onClick();
            modal.props.onClose();
            assert.deepEqual(calls, []);
            assert.deepEqual(states, [], 'Busy modal cannot close or start a competing save');
          } else {
            await history.props.onRestore();
            assert.ok(states.includes(false));
            assert.ok(states.includes(null));
            assert.ok(states.some((value) => value?.naziv === ''));
            assert.deepEqual(calls, owner === 'site' ? ['site-details', 'parent']
              : ['fetchGradilista', 'fetchRokovi', 'fetchTerminskiPlanZadaci', 'fetchKooperantAngazmani', 'fetchKooperanti']);
          }
        }
      }
    });
