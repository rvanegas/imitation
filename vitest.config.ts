import { defineConfig } from 'vitest/config';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const testStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imitation-test-'));

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    pool: 'forks',
    fileParallelism: false,
    env: {
      XDG_STATE_HOME: testStateDir,
      XDG_CONFIG_HOME: testStateDir,
      XDG_RUNTIME_DIR: testStateDir,
    },
    setupFiles: ['./tests/helpers/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
