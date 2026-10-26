import { createRequire } from 'node:module';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';
import tailwind from 'tailwindcss';

// Offline layout fixtures: no authentication bypass or requests to the live database.
const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const storage = { getItem: () => null, setItem() {}, removeItem() {} };
const worker = {
  id: 'worker', ime: 'Aleksandar', prezime: 'Dugacko-prezime-za-provjeru',
  uloga: 'radnik', status: 'aktivan', cijena_sata: 12, nocni_dodatak: 30,
  teren_dnevnica: 25, bonusi: [], pravo_nocni: true, pravo_teren: true,
};
const vehicle = {
  id: 'vehicle', marka: 'Mercedes', model: 'Sprinter dugi naziv vozila',
  registracija: 'ZG-1234-AA', tip: 'teretno', status: 'slobodno',
  kilometraza: 123456, broj_mjesta: 7, napomena: null,
};
const site = {
  id: 'site', naziv: 'Gradiliste s dugackim nazivom za provjeru prijeloma',
  status: 'aktivno', adresa: 'Ulica gradilista 123', regija: 'zagreb_i_okolica',
};
const api = new Proxy({}, { get: (_, name) => name === '__esModule' ? true : async () => [] });
const auth = {
  useAuth: () => ({
    canAccess: () => true, isAdmin: true, isPlatformOwner: true,
    company: { id: 'company', naziv: 'Tvrtka s dugim nazivom za provjeru' },
    profile: { id: 'user', email: 'korisnik.s.dugim.imenom@example.test', approved: true, radnik_id: 'worker' },
    session: {}, loading: false,
  }),
};
const stateFixtures = {
  'KorisniciView.tsx': {
    users: [{
      id: 'managed-user', company_id: 'company', email: 'very.long.employee.address@example.test',
      approved: true, is_admin: false, is_voditelj: true, is_platform_owner: false, radnik_id: 'worker',
      permissions: Object.fromEntries('dashboard gradilista radnici vozila alat strojevi investitori objekti kooperanti stavke ponude raspored radni_nalozi troskovi fakture radno_vrijeme rekapitulacija obavijesti asistent postavke'.split(' ').map((id) => [id, { can_view: true, can_edit: false }])),
    }],
    workers: [worker],
  },
  'GradilisteMaterijalDokumenti.tsx': {
    stavke: [{ id: 'material', tip: 'materijal', naziv: 'Materijal s dugim nazivom za provjeru rasporeda', gotovo: true }],
    dokumenti: Array.from({ length: 18 }, (_, index) => ({
      id: `photo-${index}`, vrsta: 'slika', naziv: `Fotografija ${index + 1}.svg`,
      url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect width="400" height="300" fill="lightblue"/%3E%3C/svg%3E',
    })),
  },
  'GradilisteDetailsPanel.tsx': {
    details: { troskovi: [], radnoVrijeme: [], nalozi: [{
      id: 'order', broj: 'RN-123', naslov: 'Radni nalog', status: 'otvoren', prioritet: 'srednji',
    }], rokovi: [], fakture: [], ugovoreniRadovi: [] },
    zadaci: [{ id: 'task', naziv: 'Provjera detaljnog pregleda gradilista', vrsta: 'zadatak', gotovo: true }],
  },
  'PonudaEditor.tsx': {
    lines: [{
      key: 'line', stavka_id: null, opis: 'Stavka ponude s duljim opisom za provjeru tablice', jedinica: 'kom',
      kolicina: '15', cijena: '123.45', popust: '5', vrsta: '', podgrupa: '', spremiUBazu: false,
    }],
  },
  'RadniNaloziView.tsx': { period: 'svi', items: [{
    id: 'order', broj: 'RN-2026-123', naslov: 'Radni nalog s dugim nazivom',
    opis: 'Detaljan opis posla '.repeat(10), status: 'otvoren', prioritet: 'srednji',
    mobile_status: 'u_tijeku', radnici: [worker], gradilista: site, rok: '2026-10-26',
  }] },
  'RasporedView.tsx': { vozila: [vehicle, { ...vehicle, id: 'vehicle2' }, { ...vehicle, id: 'vehicle3' }], gradilista: [site], radnici: [worker] },
  'RadnoVrijemeView.tsx': { items: [{ id: 'time', radnik_id: 'worker', datum: '2026-10-26', sati: 8, radnici: worker, gradilista: site }] },
  'ObracunSatiPanel.tsx': { radnici: [worker], selectedRadnikId: 'worker', unosi: [{
    id: 'time', radnik_id: 'worker', datum: '2026-10-26', sati: 8, nocni_sati: 2, teren: true,
    gradiliste_naziv: site.naziv, nalog_broj: 'RN-123', nalog_naslov: 'Bojanje',
  }] },
  'NalogIzvrsenje.tsx': {
    vremena: [{ radnik_id: worker.id, radnik: worker, vrijeme_od: '06:00', vrijeme_do: '16:00' }],
    napomena: 'Napomena na nalogu '.repeat(10),
    zadaci: [{ id: 'task', naziv: 'Radni zadatak s dugackim nazivom '.repeat(4), gotovo: false }],
    stavke: [{ id: 'material', tip: 'materijal', naziv: 'Materijal za gradiliste', gotovo: false }],
  },
};

function loader(overrides = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const fixtures = { ...stateFixtures[path.basename(filename)], ...overrides[path.basename(filename)] };
    const source = readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      transformers: { before: [(context) => {
        const visit = (node) => {
          if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer &&
              ts.isCallExpression(node.initializer) && node.initializer.expression.getText() === 'useState') {
            const name = node.name.elements[0]?.name?.getText();
            const value = Object.hasOwn(fixtures, name) ? fixtures[name] : /^(loading|loading\w*|isLoading)$/.test(name) ? false : undefined;
            if (value !== undefined) {
              return context.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
                context.factory.updateCallExpression(node.initializer, node.initializer.expression, node.initializer.typeArguments,
                  [context.factory.createCallExpression(context.factory.createPropertyAccessExpression(context.factory.createIdentifier('JSON'), 'parse'),
                    undefined, [context.factory.createStringLiteral(JSON.stringify(value))])]));
            }
          }
          return ts.visitEachChild(node, visit, context);
        };
        return (node) => ts.visitNode(node, visit);
      }] },
    }).outputText;
    vm.runInNewContext(compiled, {
      module, exports: module.exports, console, localStorage: storage,
      window: { localStorage: storage, location: { origin: 'http://localhost' }, matchMedia: () => ({ matches: false }) },
      document: { getElementById: () => null }, URL, Blob, Date, setTimeout, clearTimeout,
      require: (name) => {
        if (/\/api$/.test(name)) return api;
        if (/\/useAuth$/.test(name)) return auth;
        if (/\/company$/.test(name)) return { companyStorage: storage, requireCompany: () => ({ id: 'company', naziv: 'Demo tvrtka', oib: '00000000000' }) };
        if (/\/supabase$/.test(name)) return { supabase: {} };
        if (/\/usePushRegistration$/.test(name)) return { usePushRegistration: () => null };
        if (name === '@capacitor/core') return { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } };
        if (name.startsWith('@/') || name.startsWith('.')) {
          const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
          const resolved = ['.tsx', '.ts', '\\index.ts'].map((ext) => base + ext).find(existsSync);
          if (!resolved) throw new Error(`Cannot resolve ${name} in ${filename}`);
          return load(resolved);
        }
        return require(name);
      },
    }, { filename });
    return module.exports;
  }
  return load;
}

export async function buildResponsiveFixtures() {
  const views = [
    ['Dashboard', { onNavigate() {} }], ['GradilistaView', {}], ['RegistryViews', {}, 'InvestitoriView'],
    ['RegistryViews', {}, 'ObjektiView'], ['KooperantiView', {}], ['StavkeView', {}], ['PonudeView', {}],
    ['RadniciView', {}], ['VozilaView', {}], ['OpremaView', { kategorija: 'alat' }], ['OpremaView', { kategorija: 'stroj' }],
    ['RasporedView', {}], ['TroskoviView', {}], ['FaktureView', {}], ['RadnoVrijemeView', {}],
    ['RadniNaloziView', {}], ['RekapitulacijaView', {}], ['ObavijestiView', { onNavigate() {} }],
    ['PostavkeView', {}], ['AsistentView', { onNavigate() {} }], ['KorisniciView', {}], ['TvrtkeView', {}],
    ['ObracunSatiPanel', { canEdit: true }],
    ['GradilisteMaterijalDokumenti', { gradilisteId: site.id }],
    ['GradilisteDetailsPanel', { gradiliste: site, onClose() {}, onEdit() {}, onGradilisteUpdate() {} }],
    ['PonudaEditor', { open: true, ponuda: null, ponudaStavke: [], investitori: [], objekti: [], baza: [], onClose() {}, onSaved() {}, onBazaChanged() {}, onLookupsChanged() {} }],
  ];
  const load = loader();
  const fixtures = [];
  for (const [file, props, exportName = file] of views) {
    const Component = load(path.join(root, 'src', 'components', 'views', `${file}.tsx`))[exportName];
    try {
      fixtures.push({ name: exportName + (props.kategorija ? `-${props.kategorija}` : ''), reserveSidebar: !['GradilistaView', 'RasporedView'].includes(file), html: renderToStaticMarkup(React.createElement(Component, props)) });
    } catch (error) {
      throw new Error(`Rendering ${exportName}: ${error.message}`, { cause: error });
    }
  }
  for (const name of ['RadniciView', 'FaktureView', 'KooperantiView', 'RadnoVrijemeView']) {
    const modalLoader = loader({ [`${name}.tsx`]: { modalOpen: true } });
    const Component = modalLoader(path.join(root, 'src', 'components', 'views', `${name}.tsx`))[name];
    fixtures.push({ name: `${name}-modal`, html: renderToStaticMarkup(React.createElement(Component)) });
  }
  for (const file of ['MobileWorkOrdersView', 'WorkerPortalTabs']) {
    const exports = load(path.join(root, 'src', 'components', 'mobile', `${file}.tsx`));
    for (const [name, props] of file === 'MobileWorkOrdersView' ? [['MobileWorkOrdersView', {}]] :
      [['RasporedVozilaPreview', { vozila: [] }], ['WorkerTimeTab', {}], ['WorkerDocumentsTab', { radnikId: 'worker', orders: [] }]]) {
      fixtures.push({ name, html: renderToStaticMarkup(React.createElement(exports[name], props)) });
    }
  }
  const { Modal } = load(path.join(root, 'src', 'components', 'ui', 'Modal.tsx'));
  const { Sidebar } = load(path.join(root, 'src', 'components', 'Sidebar.tsx'));
  fixtures.push({ name: 'Sidebar-mobile', html: renderToStaticMarkup(React.createElement(Sidebar, {
    current: 'dashboard', mobileOpen: true, counts: {}, onNavigate() {}, onMobileClose() {},
  })) });
  const { NalogIzvrsenje } = load(path.join(root, 'src', 'components', 'views', 'NalogIzvrsenje.tsx'));
  fixtures.push({ name: 'NalogIzvrsenje', html: renderToStaticMarkup(React.createElement(NalogIzvrsenje, {
    nalog: { id: 'order', gradiliste_id: site.id },
  })) });
  const table = React.createElement('div', { className: 'min-w-0 max-w-full overflow-x-auto' },
    React.createElement('table', { className: 'min-w-[1200px]' }, React.createElement('tbody', null,
      React.createElement('tr', null, React.createElement('td', null, 'Tablica unutar prozora')))));
  fixtures.push({ name: 'Modal', html: renderToStaticMarkup(React.createElement(Modal, {
    open: true, title: 'Dugacak naslov prozora '.repeat(6), wide: 'screen', onClose() {},
    footer: React.createElement(React.Fragment, null, ...Array.from({ length: 5 }, (_, i) => React.createElement('button', { key: i, className: 'rounded border p-3' }, `Akcija ${i + 1}`))),
  }, table)) });
  const config = (await import('../tailwind.config.js')).default;
  const css = await postcss([tailwind(config)]).process(readFileSync(path.join(root, 'src', 'index.css'), 'utf8'), { from: undefined });
  const html = `<!doctype html><html lang="hr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${css.css}</style><body class="bg-slate-50">
    ${fixtures.map(({ name, html, reserveSidebar }) => `<div data-fixture="${name}" hidden><div class="mx-auto min-w-0 w-full max-w-[2560px] p-3 xl:px-8 2xl:px-12 ${reserveSidebar ? 'xl:ml-64 xl:w-[calc(100%_-_16rem)]' : ''}">${html}</div></div>`).join('\n')}
    </body></html>`;
  return { fixtures, html };
}

if (process.argv[2]) {
  const { fixtures, html } = await buildResponsiveFixtures();
  writeFileSync(process.argv[2], html);
  console.log(`Rendered ${fixtures.length} offline responsive fixtures.`);
}
