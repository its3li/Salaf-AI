import { describe, it, expect, vi, afterEach } from 'vitest';
import { createClientUuid } from './ids';
afterEach(() => vi.unstubAllGlobals());
describe('LAN browser identifiers', () => {
  it('creates a UUID when randomUUID is not available on insecure LAN HTTP', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(123); return bytes; } });
    expect(createClientUuid()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  });
});
