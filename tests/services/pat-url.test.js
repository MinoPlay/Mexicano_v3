/**
 * PAT-in-URL Bootstrap — pure URL parsing/building.
 * See .github/features/pat-url-bootstrap.md
 */
import { describe, it, expect } from 'vitest';
import { parsePatFromUrl, buildPatUrl } from '../../js/services/pat-url.js';

describe('parsePatFromUrl', () => {
  it('reads pat from search query and strips it', () => {
    const r = parsePatFromUrl('https://x.io/app/?pat=ghp_ABC#/');
    expect(r.pat).toBe('ghp_ABC');
    expect(r.cleanUrl).toBe('https://x.io/app/#/');
  });

  it('reads pat from hash query and strips it', () => {
    const r = parsePatFromUrl('https://x.io/app/#/?pat=ghp_ABC');
    expect(r.pat).toBe('ghp_ABC');
    expect(r.cleanUrl).toBe('https://x.io/app/#/');
  });

  it('returns null pat and unchanged url when absent', () => {
    const r = parsePatFromUrl('https://x.io/app/#/settings');
    expect(r.pat).toBeNull();
    expect(r.cleanUrl).toBe('https://x.io/app/#/settings');
  });

  it('treats empty pat= as absent and leaves url unchanged', () => {
    const r = parsePatFromUrl('https://x.io/app/?pat=#/');
    expect(r.pat).toBeNull();
    expect(r.cleanUrl).toBe('https://x.io/app/?pat=#/');
  });

  it('removes only pat and preserves other params + hash', () => {
    const r = parsePatFromUrl('https://x.io/app/?foo=1&pat=ghp_ABC&bar=2#/x');
    expect(r.pat).toBe('ghp_ABC');
    expect(r.cleanUrl).toBe('https://x.io/app/?foo=1&bar=2#/x');
  });
});

describe('buildPatUrl', () => {
  it('adds pat to the search part, preserving hash', () => {
    expect(buildPatUrl('https://x.io/app/#/', 'ghp_ABC')).toBe('https://x.io/app/?pat=ghp_ABC#/');
  });
});
