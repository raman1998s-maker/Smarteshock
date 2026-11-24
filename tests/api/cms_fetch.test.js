// Esegue i test Python di scripts/cms_fetch.py dentro `npm test`
// (server Supabase finto su 127.0.0.1, nessuna rete esterna).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./cms_fetch_test.py', import.meta.url));
const probe = spawnSync('python3', ['--version'], { encoding: 'utf8' });

test('scripts/cms_fetch.py (unittest Python)', { skip: probe.status !== 0 ? 'python3 non disponibile' : false }, () => {
  const env = { ...process.env };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_ANON_KEY;
  const res = spawnSync('python3', ['-I', script], { encoding: 'utf8', env, timeout: 60_000 });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
});
