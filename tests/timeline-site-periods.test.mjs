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
  class Element { closest() { return null; } }
  const states = {
    gradilista: [site], loading: false, rangeStart: '2026-11-06', statusFilter: 'prekoraceni',
    selectedKooperantIds: [], includeUnassigned: false, ...overrides,
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date, Element,
    require(name) {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'react') return {
        useEffect() {}, useMemo: (fn) => fn(), useRef: (current) => ({ current }),
        useState(initial) {
          const key = stateNames[index++];
          return [key in states ? states[key] : typeof initial === 'function' ? initial() : initial,
            (value) => { states[key] = typeof value === 'function' ? value(states[key]) : value; }];
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
  return {
    tree, states, pdf: () => pdf, markers: nodes(tree).filter((node) => node.props.role === 'img'),
    element: new Element(),
  };
}

function dragHarness(dayWidth = 42, overrides = {}) {
  const view = render(overrides);
  const grid = nodes(view.tree).find((node) => node.props.onPointerDown);
  let captured = false;
  const currentTarget = {
    querySelector: () => ({ getBoundingClientRect: () => ({ width: dayWidth }) }),
    setPointerCapture() { captured = true; },
    hasPointerCapture() { return captured; },
    releasePointerCapture() { captured = false; },
  };
  const event = (x, y = 0, extra = {}) => ({
    isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: y,
    currentTarget, target: view.element, ...extra,
  });
  return { ...view, handlers: grid.props, event, captured: () => captured };
}

test('drag pans dates in both directions using actual day width without cumulative drift', () => {
  for (const width of [42, 75]) {
    const h = dragHarness(width, { viewWeeks: 4 });
    h.handlers.onPointerDown(h.event(300));
    h.handlers.onPointerMove(h.event(300 - width * 2));
    assert.equal(h.states.rangeStart, '2026-11-08');
    assert.equal(h.captured(), true);
    h.handlers.onPointerMove(h.event(300 + width));
    assert.equal(h.states.rangeStart, '2026-11-05');
    h.handlers.onPointerUp(h.event(300 + width));
    assert.equal(h.captured(), false);
    assert.equal(h.states.panning, false);
    h.handlers.onPointerMove(h.event(0));
    assert.equal(h.states.rangeStart, '2026-11-05');
  }
});

test('small movements, vertical gestures, secondary buttons and labels do not pan', () => {
  for (const scenario of ['small', 'vertical', 'secondary', 'label']) {
    const h = dragHarness();
    if (scenario === 'label') h.element.closest = () => ({});
    h.handlers.onPointerDown(h.event(100, 0, { button: scenario === 'secondary' ? 2 : 0 }));
    if (scenario === 'vertical') h.handlers.onPointerMove(h.event(101, 30));
    h.handlers.onPointerMove(h.event(scenario === 'small' ? 103 : 0));
    assert.equal(h.states.rangeStart, '2026-11-06', scenario);
    assert.equal(h.captured(), false, scenario);
  }
});

test('drag blocks accidental bar clicks, preserves keyboard activation and resets for next click', () => {
  const h = dragHarness();
  let prevented = false;
  const click = { detail: 1, preventDefault() { prevented = true; }, stopPropagation() {} };
  h.handlers.onPointerDown(h.event(100));
  h.handlers.onPointerMove(h.event(0));
  h.handlers.onPointerCancel(h.event(0));
  h.handlers.onClickCapture({ ...click, detail: 0 });
  assert.equal(prevented, false);
  h.handlers.onClickCapture(click);
  assert.equal(prevented, true);
  prevented = false;
  h.handlers.onPointerDown(h.event(100));
  h.handlers.onPointerUp(h.event(100));
  h.handlers.onClickCapture(click);
  assert.equal(prevented, false);
});

test('empty date ranges keep the calendar available for dragging back to activities', () => {
  const h = dragHarness(42, { gradilista: [] });
  assert.ok(nodes(h.tree).some((node) => node.props.className?.includes('terminski-plan-day-header')));
  h.handlers.onPointerDown(h.event(100));
  h.handlers.onPointerMove(h.event(142));
  assert.equal(h.states.rangeStart, '2026-11-05');
});

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
