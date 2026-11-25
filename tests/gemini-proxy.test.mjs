import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../supabase/functions/gemini-proxy/index.ts', import.meta.url), 'utf8');

test('Gemini proxy starts with stable model and retries transient failures', () => {
  assert.match(source, /'gemini-2\.5-flash'/);
  assert.match(source, /'gemini-2\.0-flash'/);
  assert.match(source, /RETRYABLE_STATUSES = new Set\(\[429, 500, 502, 503, 504\]\)/);
  assert.ok(source.indexOf("'gemini-2.5-flash'") < source.indexOf("'gemini-3-flash-preview'"));
  assert.match(source, /AI servis je trenutačno preopterećen/);
});
