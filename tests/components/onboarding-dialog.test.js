import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../js/store.js';
import * as onboarding from '../../js/components/onboarding-dialog.js';

describe('Supabase onboarding state', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('requires access before player selection and skips only when both exist', () => {
    expect(typeof onboarding.getOnboardingStep).toBe('function');
    expect(onboarding.getOnboardingStep()).toBe('access');

    Store.setAccessGrant({ role: 'member', expires_at: '2099-01-01T00:00:00Z' });
    expect(onboarding.getOnboardingStep()).toBe('player');

    Store.setCurrentPlayerId('player-1');
    Store.setCurrentUser('Mattijs');
    expect(onboarding.getOnboardingStep()).toBe(null);
  });

  it('replaces stale project config and clears project-bound browser state', async () => {
    Store.setSupabaseConfig({
      url: 'https://edasyhcgpdhsynufbcll.supabase.co',
      anonKey: 'old-anon-key',
    });
    Store.setSupabaseSession({
      access_token: 'old-access-token',
      refresh_token: 'old-refresh-token',
      expires_at: 9999999999,
    });
    Store.setAccessGrant({ role: 'member', expires_at: '2099-01-01T00:00:00Z' });
    Store.setCurrentPlayerId('old-player-id');
    Store.setCurrentUser('Mattijs');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: 'https://btyfcijkkwjhtcecrggm.supabase.co',
        anonKey: 'new-anon-key',
      }),
    }));

    expect(typeof onboarding.ensurePublicConfig).toBe('function');
    await onboarding.ensurePublicConfig();

    expect(fetch).toHaveBeenCalledWith('./data/supabase-config.json', { cache: 'no-store' });
    expect(Store.getSupabaseConfig()).toEqual({
      url: 'https://btyfcijkkwjhtcecrggm.supabase.co',
      anonKey: 'new-anon-key',
    });
    expect(Store.getSupabaseSession()).toBeNull();
    expect(Store.getAccessRole()).toBe('');
    expect(Store.getCurrentPlayerId()).toBeNull();
    expect(Store.getCurrentUser()).toBe('');
  });

  it('shows password, magic-link, and shared-code authentication choices', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        url: 'https://btyfcijkkwjhtcecrggm.supabase.co',
        anonKey: 'public-anon-key',
      }),
    }));

    onboarding.showOnboardingDialog();

    await vi.waitFor(() => {
      const text = document.body.textContent;
      expect(text).toContain('Sign in with password');
      expect(text).toContain('Send magic link');
      expect(text).toContain('Use shared access code');
    });
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
  });
});
