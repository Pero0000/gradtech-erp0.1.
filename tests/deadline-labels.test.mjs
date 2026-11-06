import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const module = { exports: {} };
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-11-06T12:00:00'])); }
}
vm.runInNewContext(ts.transpileModule(read('src/lib/rokovi.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { module, exports: module.exports, Date: FixedDate });
const { currentRokDeadline, nextDeadline, deadlineAlert } = module.exports;
const site = { id: 'site', status: 'aktivno' };
const period = {
  id: 'ceramics', gradiliste_id: 'site', naziv: 'Keramika', status: 'otvoren',
  datum: '2026-11-10', datum_pocetka: '2026-11-07', datum_zavrsetka: '2026-11-10',
};

test('period deadline labels follow the displayed boundary before, on and after the start', () => {
  for (const today of ['2026-11-06', '2026-11-07']) {
    const deadline = currentRokDeadline(period, today);
    assert.equal(deadline.datum, '2026-11-07');
    assert.equal(deadline.label, 'Keramika · Početni rok');
  }
  for (const today of ['2026-11-08', '2026-11-10', '2026-11-11']) {
    const deadline = currentRokDeadline(period, today);
    assert.equal(deadline.datum, '2026-11-10');
    assert.equal(deadline.label, 'Keramika · Krajnji rok');
  }
});

test('single-day, legacy and task deadlines are final deadlines, not false starts', () => {
  for (const item of [
    { ...period, datum_pocetka: period.datum_zavrsetka },
    { ...period, datum_pocetka: null, datum_zavrsetka: null },
    { ...period, datum_pocetka: undefined, datum_zavrsetka: undefined },
  ]) {
    assert.equal(currentRokDeadline(item).label, 'Keramika · Krajnji rok');
    assert.equal(currentRokDeadline(item).datum, period.datum);
  }
});

test('site cards and schedule choose upcoming start then final date after start has passed', () => {
  assert.equal(nextDeadline(site, [period]).label, 'Keramika · Početni rok');
  assert.equal(nextDeadline(site, [period]).datum, '2026-11-07');
  const started = { ...period, datum_pocetka: '2026-11-03', datum_zavrsetka: '2026-11-08' };
  assert.equal(nextDeadline(site, [started]).label, 'Keramika · Krajnji rok');
  assert.equal(nextDeadline(site, [started]).datum, '2026-11-08');
  assert.equal(nextDeadline(site, [{ ...period, status: 'zavrsen' }]), null);
  assert.equal(nextDeadline(site, [{ ...period, gradiliste_id: 'other' }]), null);
});

test('alerts do not flag a passed start as overdue; final deadlines retain overdue priority', () => {
  const upcoming = deadlineAlert(site, [period]);
  assert.equal(upcoming.label, 'Keramika · Početni rok');
  assert.equal(upcoming.level, 'soon');
  const ongoing = { ...period, datum_pocetka: '2026-11-03', datum_zavrsetka: '2026-11-08' };
  assert.equal(deadlineAlert(site, [ongoing]).label, 'Keramika · Krajnji rok');
  assert.equal(deadlineAlert(site, [ongoing]).level, 'soon');
  const overdue = { ...period, datum_pocetka: '2026-11-01', datum_zavrsetka: '2026-11-05' };
  assert.equal(deadlineAlert(site, [period, overdue]).level, 'overdue');
  assert.equal(deadlineAlert(site, [overdue]).label, 'Keramika · Krajnji rok');
  assert.equal(deadlineAlert({ ...site, status: 'zavrseno' }, [overdue]), null);
  assert.equal(deadlineAlert({ ...site, status: 'neplaceno' }, [overdue]), null);
});

test('notifications and dashboard use boundary-aware labels; full date ranges label both boundaries', () => {
  const notifications = read('src/lib/obavijesti.ts');
  assert.match(notifications, /currentRokDeadline\(r, today\)/);
  assert.match(notifications, /deadline.label, deadline.datum/);
  for (const file of ['src/components/views/GradilisteDetailsPanel.tsx', 'src/components/views/TerminskiPlanView.tsx']) {
    const source = read(file);
    assert.match(source, /Početni rok: \$\{/);
    assert.match(source, /Krajnji rok: \$\{/);
  }
  assert.match(read('src/components/views/Dashboard.tsx'), /Krajnji rok kasni/);
});

test('notification output switches date and label together without treating past starts as late', () => {
  const notifications = { exports: {} };
  vm.runInNewContext(ts.transpileModule(read('src/lib/obavijesti.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, {
    module: notifications, exports: notifications.exports, Date: FixedDate,
    require(name) {
      if (name === '@/lib/rokovi') return module.exports;
      if (name === '@/lib/postavke') return {
        obavijestTipovi: [{ tip: 'projekt_rok', grupa: 'projekti', label: 'Rok projekta' }],
      };
      return {};
    },
  });
  const source = {
    radnici: [], radnikDok: [], vozila: [], voziloDok: [], voziloObavijesti: [],
    gorivoAnomalije: [], gradilista: [{ ...site, naziv: 'Gradilište' }], fakture: [], rokovi: [period],
  };
  const settings = { obavijesti: { projekt_rok: { on: true, dana: 10 }, vozilo_servis: { on: false } } };
  const first = notifications.exports.buildObavijesti(source, settings);
  assert.equal(first.length, 1);
  assert.equal(first[0].detail, 'Keramika · Početni rok');
  assert.equal(first[0].datum, '2026-11-07');
  const afterStart = notifications.exports.buildObavijesti({
    ...source, rokovi: [{ ...period, datum_pocetka: '2026-11-03' }],
  }, settings);
  assert.equal(afterStart[0].detail, 'Keramika · Krajnji rok');
  assert.equal(afterStart[0].datum, '2026-11-10');
  assert.equal(afterStart[0].days, 4);
});
