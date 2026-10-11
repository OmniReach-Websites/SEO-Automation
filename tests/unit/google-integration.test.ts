import { describe, expect, it } from 'vitest';
import {
  EncryptedTokenVault,
  GoogleConnectionManager,
  classifyAiReferral,
  createOAuthRequest,
} from '@omnireach/integrations';

describe('Google connector foundation', () => {
  it('enforces redirect allowlist, state/nonce, and replay protection', () => {
    expect(() =>
      createOAuthRequest('https://evil.example/callback', [
        'https://admin.example.test/oauth/google',
      ]),
    ).toThrow(/allowlisted/u);
    const request = createOAuthRequest('https://admin.example.test/oauth/google', [
      'https://admin.example.test/oauth/google',
    ]);
    const manager = new GoogleConnectionManager();
    manager.acceptCallback(request, request);
    expect(() => manager.acceptCallback(request, request)).toThrow(/replay/u);
    const other = createOAuthRequest(request.redirectUri, [request.redirectUri]);
    expect(() => manager.acceptCallback(other, { ...other, state: 'wrong' })).toThrow(/mismatch/u);
  });
  it('encrypts tokens behind opaque references and revokes them', () => {
    const vault = new EncryptedTokenVault('ab'.repeat(32));
    const reference = vault.store('fictional-refresh-token');
    expect(reference).not.toContain('fictional');
    expect(vault.read(reference)).toBe('fictional-refresh-token');
    vault.revoke(reference);
    expect(() => vault.read(reference)).toThrow();
  });
  it('requires exact property mapping and idempotent metric windows', () => {
    const manager = new GoogleConnectionManager();
    manager.verifyProperty(
      { id: 'sc-1', kind: 'search_console', siteUrl: 'sc-domain:fixture.example' },
      'fixture.example',
    );
    expect(() =>
      manager.verifyProperty(
        { id: 'ga-1', kind: 'ga4', siteUrl: 'https://other.example/' },
        'fixture.example',
      ),
    ).toThrow(/exact site/u);
    const point = {
      dimensions: { source: 'chatgpt.com' },
      endDate: '2026-10-10',
      metric: 'sessions',
      propertyId: 'ga-1',
      source: 'ga4' as const,
      startDate: '2026-10-01',
      value: 2,
    };
    expect(manager.ingest([point, point])).toBe(1);
    expect(manager.ingest([point])).toBe(0);
  });
  it('classifies only documented mappings and preserves unknown sources', () => {
    expect(classifyAiReferral('chatgpt.com')).toMatchObject({
      classification: 'ChatGPT',
      mappingVersion: 1,
    });
    expect(classifyAiReferral('unknown.example')).toEqual({
      classification: null,
      mappingVersion: 1,
      source: 'unknown.example',
    });
  });
});
