import * as fs from 'fs';
import { SESSIONS_FILE, PROFILES_FILE } from '../../src/config';

beforeEach(() => {
  try { fs.unlinkSync(SESSIONS_FILE); } catch {}
  try { fs.unlinkSync(PROFILES_FILE); } catch {}
});
