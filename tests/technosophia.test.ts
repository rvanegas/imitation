/**
 * The repository's own hygiene, checked by technosophia's shared scripts:
 * planning/ filenames agree with their headings (`ts note check`) and
 * CLAUDE.md is within the cap every project shares (`ts instructions check`).
 *
 * Thin wrappers, deliberately: each rule lives in its script and nowhere
 * else. They run the scripts by path, `$TECHNOSOPHIA` or ~/src/technosophia,
 * since a test does not rely on PATH. `ts deploy` runs the tests first, so a
 * failure here stops a deploy.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..');
const technosophia = process.env.TECHNOSOPHIA ?? path.join(os.homedir(), 'src', 'technosophia');

function run(script: string, args: string[]): string {
  try {
    return execFileSync(path.join(technosophia, 'bin', script), args, {
      cwd: repoRoot,
      env: { ...process.env, TS_ROOT: repoRoot },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // Pass the script's own words through: it says which file and why.
    const e = err as { stdout?: string; stderr?: string };
    throw new Error(`ts ${script} ${args.join(' ')} failed:\n${e.stderr ?? ''}${e.stdout ?? ''}`.trimEnd());
  }
}

describe('technosophia', () => {
  it('planning/ filenames agree with their headings', () => {
    expect(run('note', ['check'])).toContain('every task and backlog filename is its heading');
  });

  it('CLAUDE.md is within the cap', () => {
    run('instructions', ['check']);
  });
});
