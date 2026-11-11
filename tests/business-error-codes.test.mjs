import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const directory = new URL('../supabase/migrations/', import.meta.url);
const fixName = '20261110690000_poslovne_greske_bez_serialization_retry.sql';
const fix = readFileSync(new URL(fixName, directory), 'utf8');
const errorPattern = /\bERRCODE\s*=\s*'40001'/gi;

function inventory() {
  const functions = new Map();
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql') && name < fixName).sort()) {
    const source = readFileSync(new URL(name, directory), 'utf8');
    const pattern = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)\s*\(/gi;
    for (const match of source.matchAll(pattern)) {
      const bodyStart = source.indexOf('$$', match.index);
      const bodyEnd = source.indexOf('$$', bodyStart + 2);
      assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, `${name}: dollar-quoted function`);
      functions.set(match[1], { name: match[1], body: source.slice(bodyStart + 2, bodyEnd) });
    }
  }
  return [...functions.values()].filter(fn => fn.body.match(errorPattern));
}

test('all current custom 40001 assignments become P0001, with exact preservation of bodies and function metadata', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE SCHEMA private;
    CREATE ROLE authenticated;
    SET check_function_bodies = off;
  `);
  const functions = inventory();
  assert.equal(functions.length, 30);
  assert.equal(functions.reduce((sum, fn) => sum + [...fn.body.matchAll(errorPattern)].length, 0), 43);
  for (const fn of functions) {
    await db.exec(`CREATE FUNCTION ${fn.name}(p_inventory integer DEFAULT 1)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, pg_temp
      AS $body$${fn.body}$body$;
      REVOKE ALL ON FUNCTION ${fn.name}(integer) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION ${fn.name}(integer) TO authenticated;
      COMMENT ON FUNCTION ${fn.name}(integer) IS 'Preserve business checks';`);
  }
  await db.exec(`
    CREATE FUNCTION public.untouched() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'Denied' USING ERRCODE = '42501';
    END $$;
    CREATE FUNCTION public.genuine_serialization_handler() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      NULL;
    EXCEPTION WHEN SQLSTATE '40001' THEN RAISE;
    END $$;
  `);
  const snapshot = () => db.query(`
    SELECT p.oid, n.nspname || '.' || p.proname AS name, p.prosrc AS body,
      p.proowner, p.proacl::text, p.prosecdef, p.provolatile, p.proconfig,
      obj_description(p.oid, 'pg_proc') AS comment
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') ORDER BY p.oid
  `);
  const before = (await snapshot()).rows;
  await db.exec(fix);
  const after = (await snapshot()).rows;
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    assert.deepEqual(after[i], { ...before[i], body: before[i].body.replace(errorPattern, match => match.replace('40001', 'P0001')) });
  }
  await db.exec(fix);
  assert.deepEqual((await snapshot()).rows, after, 'migration is idempotent');
});

test('permanent business exception leaves 40001 untouched only as a genuine serialization handler', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE SCHEMA private;
    CREATE FUNCTION public.business_rule() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'Ekipa je zaključana.' USING ERRCODE='40001';
    END $$;
  `);
  await db.exec(fix);
  await assert.rejects(db.query('SELECT public.business_rule()'), error => {
    assert.equal(error.code, 'P0001');
    assert.equal(error.message, 'Ekipa je zaključana.');
    return true;
  });
});
