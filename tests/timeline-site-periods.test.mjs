import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

const source = readFileSync(new URL('../src/components/views/TerminskiPlanView.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const stateNames = [...source.matchAll(/const \[(\w+),[^\]]+\] = useState/g)].map((match) => match[1]);
const site = { id: 'site', naziv: 'Orijentir', status: 'aktivno', datum_pocetka: '2026-11-07', datum_zavrsetka: '2026-11-12' };
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  return node?.props ? [node, ...nodes(node.props.children)] : [];
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  return node?.props ? text(node.props.children) : typeof node === 'string' ? node : '';
}
function render(overrides = {}) {
  let index = 0;
  let pdf;
  const states = {
    gradilista: [site], loading: false, rangeStart: '2026-11-06', statusFilter: 'prekoraceni',
    selectedKooperantIds: [], includeUnassigned: false, ...overrides,
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date,
    require(name) {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'react') return {
        useEffect() {}, useMemo: (fn) => fn(),
        useState(initial) {
          const key = stateNames[index++];
          return [key in states ? states[key] : typeof initial === 'function' ? initial() : initial, () => {}];
        },
      };
      if (name === '@/auth/useAuth') return { useAuth: () => ({ canAccess: () => true }) };
      if (name === '@/lib/localization') return { formatHrDate: (date) => date.toISOString().slice(0, 10) };
      if (name === '@/lib/obracunSati') return { hrPraznici: () => new Map() };
      if (name === '@/lib/terminskiPlanPdf') return { exportTerminskiPlanPdf: async (spec) => { pdf = spec; } };
      return new Proxy({}, { get: () => () => null });
    },
  });
  const tree = module.exports.TerminskiPlanView({ onOpenGradiliste() {} });
  return { tree, pdf: () => pdf, markers: nodes(tree).filter((node) => node.props.role === 'img') };
}

test('dated sites without activities remain as subtle planning references despite activity filters', () => {
  const view = render();
  assert.equal(view.markers.length, 1);
  assert.match(text(view.tree), /Početak: 2026-11-07Kraj: 2026-11-12/);
  assert.match(view.markers[0].props['aria-label'], /Početak gradilišta.*Kraj gradilišta/);
  assert.equal(view.markers[0].props.style.left, `${1.5 / 14 * 100}%`);
  assert.equal(view.markers[0].props.style.width, `${5 / 14 * 100}%`);
  assert.ok(nodes(view.markers[0]).some((node) => node.props.className?.includes('border-dashed')));
});

test('site period clipping, single endpoints, range boundaries and site filter are respected', () => {
  const clipped = render({ gradilista: [{ ...site, datum_pocetka: '2026-10-01', datum_zavrsetka: '2026-12-01' }] });
  assert.equal(clipped.markers[0].props.style.left, '0%');
  assert.equal(clipped.markers[0].props.style.width, '100%');
  for (const dates of [
    { datum_pocetka: '2026-11-06', datum_zavrsetka: null },
    { datum_pocetka: null, datum_zavrsetka: '2026-11-19' },
    { datum_pocetka: '2026-11-10', datum_zavrsetka: '2026-11-10' },
  ]) {
    const view = render({ gradilista: [{ ...site, ...dates }] });
    assert.equal(view.markers.length, 1);
    assert.equal(view.markers[0].props.style.width, '0%');
  }
  for (const dates of [
    { datum_pocetka: null, datum_zavrsetka: null },
    { datum_pocetka: '2026-11-20', datum_zavrsetka: '2026-11-25' },
    { datum_pocetka: '2026-11-01', datum_zavrsetka: '2026-11-05' },
  ]) assert.equal(render({ gradilista: [{ ...site, ...dates }] }).markers.length, 0);
  assert.equal(render({ selectedSite: 'other' }).markers.length, 0);
});

test('reference remains expanded and PDF includes dates even without any activities', async () => {
  const view = render({ expandedSiteIds: ['site'] });
  assert.equal(view.markers.length, 1);
  const button = nodes(view.tree).find((node) => node.type === 'button' && text(node).includes('Izvezi PDF'));
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(view.pdf().redovi.length, 1);
  const row = view.pdf().redovi[0];
  assert.equal(row.pocetak, site.datum_pocetka);
  assert.equal(row.kraj, site.datum_zavrsetka);
  assert.equal(row.orijentir, true);
  assert.match(row.status, /Početak:.*Kraj:/);
});
