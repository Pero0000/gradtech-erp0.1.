import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResponsiveFixtures } from './responsive-fixtures.mjs';
import config from '../tailwind.config.js';

test('layout breakpoints match phone, tablet, laptop and half-monitor widths', () => {
  assert.deepEqual(config.theme.screens, {
    sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1720px',
  });
});

test('offline responsive fixtures render ERP screens, worker portal and constrained dialogs', async () => {
  const { fixtures, html } = await buildResponsiveFixtures();
  assert.ok(fixtures.length >= 37);
  assert.equal(new Set(fixtures.map(({ name }) => name)).size, fixtures.length);
  for (const name of ['RasporedView', 'RadniNaloziView', 'ObracunSatiPanel', 'MobileWorkOrdersView', 'Sidebar-mobile', 'Modal',
    'GradilisteDetailsPanel', 'GradilisteMaterijalDokumenti', 'PonudaEditor', 'RadniciView-modal', 'KorisniciView']) {
    assert.ok(fixtures.some((fixture) => fixture.name === name), `Missing fixture: ${name}`);
  }
  const modal = fixtures.find((fixture) => fixture.name === 'Modal').html;
  assert.match(modal, /max-h-\[96dvh\]/);
  assert.match(modal, /min-w-\[1200px\]/);
  assert.match(modal, /overflow-x-auto/);
  assert.match(modal, /overflow-y-auto/);
  assert.match(html, /min-width:\s*1280px/);
  assert.match(html, /min-width:\s*1720px/);
  assert.match(html, /xl:ml-64/);
});
