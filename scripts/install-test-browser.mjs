import { spawnSync } from 'node:child_process';
import path from 'node:path';
const browserPath = path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode', 'playwright');
const result = spawnSync(process.execPath, ['node_modules/playwright/cli.js', 'install', 'chromium'], {
  stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath },
});
process.exitCode = result.status || 0;
