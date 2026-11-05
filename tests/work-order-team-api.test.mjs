import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');

function loadApi({ order, team, hours, rpcError = null }) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require: (name) => {
      if (name === './supabase') {
        return { supabase: {
          from(table) {
            calls.push(['from', table]);
            return {
              select(columns) {
                calls.push(['select', columns]);
                return {
                  eq(column, value) {
                    calls.push(['eq', column, value]);
                    return {
                      single: async () => ({ data: order, error: null }),
                      then(resolve, reject) {
                        return Promise.resolve({ data: team, error: null }).then(resolve, reject);
                      },
                      limit: async () => ({ data: hours, error: null }),
                    };
                  },
                };
              },
            };
          },
          rpc: async (...args) => { calls.push(['rpc', ...args]); return { error: rpcError }; },
        } };
      }
      if (['./postavke', './obracunSati', './vehicleKmCosts', './company', './pagination', './rokovi', './imageCompression'].includes(name)) {
        return {};
      }
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { api: module.exports, calls };
}

const input = {
  gradiliste_id: null, naslov: 'Nalog', opis: null, status: 'otvoren',
  prioritet: 'srednji', rok: null, radnik_ids: ['replacement'],
};

test('work-order API blocks team changes before any writes when execution has started or hours exist', async () => {
  const started = loadApi({
    order: { status: 'otvoren', mobile_status: 'u_tijeku', poslovodja_id: null },
    team: [{ radnik_id: 'worker', mobile_started_at: null, mobile_finished_at: null }],
    hours: [],
  });

  test('work-order team history API calls protected RPCs and identifies a missing migration', async () => {
    const api = loadApi({ rpcError: null });
    await api.api.fetchWorkOrderTeamChangeHistory('order', '15');
    await api.api.restoreWorkOrderTeamChange('history-id');
    assert.deepEqual(JSON.parse(JSON.stringify(api.calls.filter(([kind]) => kind === 'rpc'))), [
      ['rpc', 'get_work_order_team_change_history', { p_nalog_id: 'order', p_before_sequence: '15' }],
      ['rpc', 'restore_work_order_team_change', { p_history_id: 'history-id' }],
    ]);

    const missing = loadApi({ rpcError: { code: 'PGRST202', message: 'function not found' } });
    await assert.rejects(missing.api.fetchWorkOrderTeamChangeHistory('order'), /20261110290000_nalozi_ekipa_povijest_vracanje.sql/);
  });
  await assert.rejects(started.api.updateRadniNalog('order', input), /Ekipa se ne može mijenjati/);
  assert.equal(started.calls.some(([kind]) => kind === 'rpc'), false);

  const recordedHours = loadApi({
    order: { status: 'otvoren', mobile_status: 'dodijeljen', poslovodja_id: null },
    team: [{ radnik_id: 'worker', mobile_started_at: null, mobile_finished_at: null }],
    hours: [{ id: 'time-entry' }],
  });
  await assert.rejects(recordedHours.api.updateRadniNalog('order', input), /evidentiranja sati/);
  assert.equal(recordedHours.calls.some(([kind]) => kind === 'rpc'), false);
});
