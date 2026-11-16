// Use an isolated testing browser; no existing user profile is reused.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'playwright') },
});
process.exitCode = result.status || 0;
