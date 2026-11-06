import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

function setup(values = [], auth = {}) {
  const updates = [];
  let index = 0;
  const module = { exports: {} };
  const source = readFileSync(new URL('../src/components/auth/AuthGate.tsx', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const mocks = {
    react: {
      Fragment: 'fragment',
      useState: (initial) => {
        const slot = index++;
        return [slot < values.length ? values[slot] : initial, (value) => updates.push([slot, value])];
      },
    },
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': { Building2() {}, LogOut() {} },
    '@/auth/useAuth': {},
    '@/lib/supabase': { supabase: { auth } },
  };
  vm.runInNewContext(`${outputText}\nmodule.exports.forms = { AuthForm, PasswordRecoveryForm, authErrorText };`, {
    module, exports: module.exports, Error,
    window: { location: { origin: 'https://app.example.test' } },
    require: (name) => {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected import: ${name}`);
      return mocks[name];
    },
  });
  return { ...module.exports.forms, updates };
}

function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object' || !node.props) return [];
  return [node, ...nodes(node.props.children)];
}

test('login explains invitation setup without offering public registration', () => {
  const { AuthForm } = setup();
  const tree = nodes(AuthForm());
  assert.ok(tree.some((node) => typeof node.props.children === 'string'
    && node.props.children.includes('ne otvara račun')));
  assert.equal(tree.filter((node) => node.type === 'input' && node.props.type === 'password').length, 1);
});

test('invalid credentials are localized without claiming an account exists', async () => {
  const failure = Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' });
  const { AuthForm, updates } = setup(['login', ' test@example.test ', 'password123'], {
    signInWithPassword: async (input) => {
      assert.equal(input.email, 'test@example.test');
      return { error: failure };
    },
  });
  await nodes(AuthForm()).find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  const error = updates.find(([slot, value]) => slot === 4 && typeof value === 'string')[1];
  assert.match(error, /E-mail ili lozinka nisu ispravni/);
  assert.match(error, /pozivnicu/);
  assert.match(error, /Zaboravljena lozinka/);
});

for (const [password, confirmation, expected] of [
  ['password123', 'different123', 'Lozinke se ne podudaraju.'],
  ['short', 'short', 'Lozinka mora sadržavati najmanje 8 znakova.'],
]) {
  test(`password setup rejects ${expected}`, async () => {
    const { PasswordRecoveryForm, updates } = setup([password, confirmation]);
    let writes = 0;
    const tree = nodes(PasswordRecoveryForm({ onSave: async () => { writes++; } }));
    assert.equal(tree.filter((node) => node.type === 'input' && node.props.type === 'password').length, 2);
    await tree.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
    assert.equal(writes, 0);
    assert.ok(updates.some(([slot, value]) => slot === 2 && value === expected));
  });
}

test('password setup saves matching passwords only once', async () => {
  const { PasswordRecoveryForm } = setup(['password123', 'password123']);
  const writes = [];
  const tree = nodes(PasswordRecoveryForm({ onSave: async (password) => writes.push(password) }));
  await tree.find((node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(writes, ['password123']);
});

test('unrecognized authentication errors retain their diagnostic message', () => {
  const { authErrorText } = setup();
  assert.equal(authErrorText(new Error('Network request failed'), 'fallback'), 'Network request failed');
  assert.match(authErrorText(Object.assign(new Error('Email not confirmed'), {
    code: 'email_not_confirmed',
  }), 'fallback'), /E-mail još nije potvrđen/);
});
