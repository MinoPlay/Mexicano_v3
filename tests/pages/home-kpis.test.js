import { vi, describe, it, expect, beforeEach } from 'vitest';
import { Cache } from '../../js/cache.js';
import { Store } from '../../js/store.js';

function makeLocalStorage() {
  let store = {};
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}
const localStorageStub = makeLocalStorage();
vi.stubGlobal('localStorage', localStorageStub);

const backend = vi.hoisted(() => ({ pullMonthlyOverview: null, ensureDayMatchesLoaded: null }));
vi.mock('../../js/services/backend.js', () => ({
  pullMonthlyOverview: (...a) => backend.pullMonthlyOverview(...a),
  ensureDayMatchesLoaded: (...a) => backend.ensureDayMatchesLoaded(...a),
}));

import { renderHome } from '../../js/pages/home.js';

function kpiValues(container) {
  return Object.fromEntries([...container.querySelectorAll('#home-kpis .kpi')].map(k => [
    k.querySelector('.kpi-label').textContent,
    k.querySelector('.kpi-value').textContent,
  ]));
}

const match = (round, a, b, c, d, s1, s2) => ({
  date: '2026-11-05', roundNumber: round,
  team1Player1Name: a, team1Player2Name: b, team2Player1Name: c, team2Player2Name: d,
  scoreTeam1: s1, scoreTeam2: s2,
});

beforeEach(() => {
  localStorageStub.clear();
  Cache.clear();
  Store.clearSupabaseConfig();
  Store.clearSupabaseSession();
});

describe('Home KPIs — latest tournament', () => {
  it('shows latest winner and player count when latest day matches are loaded', () => {
    Store.setTournamentsIndex([{ date: '2026-11-05', isComplete: true }]);
    Cache.set('home_matches', [
      match(1, 'Ann', 'Bob', 'Cid', 'Dan', 16, 9),
      match(2, 'Ann', 'Cid', 'Bob', 'Dan', 14, 11),
    ]);

    const container = document.createElement('div');
    renderHome(container, {});

    const byLabel = kpiValues(container);
    expect(byLabel['Latest winner']).toBe('Ann');
    expect(byLabel['Players last time']).toBe('4');
  });

  it('places each ELO movers panel directly below its table and removes Explore', () => {
    const container = document.createElement('div');
    renderHome(container, {});
    const latest = container.querySelector('#latest-no-data').closest('.panel');
    const month = container.querySelector('#current-month-table').closest('.panel');
    expect(latest.nextElementSibling).toBe(container.querySelector('#home-movers').closest('.panel'));
    expect(month.nextElementSibling).toBe(container.querySelector('#home-month-movers').closest('.panel'));
    expect(latest.parentElement.classList.contains('span-6')).toBe(true);
    expect(month.parentElement.classList.contains('span-6')).toBe(true);
    expect(latest.parentElement.nextElementSibling).toBe(month.parentElement);
    expect([...container.querySelectorAll('.panel-title')].map(title => title.textContent)).not.toContain('Explore');
  });

  describe('Home ELO movers — current month', () => {
    function months() {
      const now = new Date();
      const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return [current, `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`];
    }

    it('shows month-start changes sorted and formatted like the latest list', () => {
      const [current, previous] = months();
      Cache.set(`monthly_${current}`, [
        { name: 'Bob', wins: 1, losses: 2, totalPoints: 30, average: 10, elo: 980, previousElo: 1000 },
        { name: 'Ann', wins: 2, losses: 1, totalPoints: 36, average: 12, elo: 1030, previousElo: 1000 },
        { name: 'Cid', wins: 1, losses: 1, totalPoints: 20, average: 10, elo: 1005, previousElo: null },
      ]);
      Cache.set(`monthly_${previous}`, [{ name: 'Bob', wins: 1, losses: 0, totalPoints: 13, average: 13, elo: 1000 }]);

      const container = document.createElement('div');
      renderHome(container, {});
      const monthly = container.querySelector('#home-month-movers').closest('.panel');
      expect(monthly.querySelector('.panel-title').textContent).toBe('ELO movers — current month');
      expect(monthly.querySelector('a').getAttribute('href')).toBe('#/elo-charts');
      expect([...monthly.querySelectorAll('#home-month-movers > div')].map(row =>
        [...row.querySelectorAll(':scope > span')].map(span => span.textContent.trim())
      )).toEqual([
        ['Ann', '', '+30.0', '1030'],
        ['Bob', '', '-20.0', '980'],
      ]);
    });

    it('shows no data when month-start ratings are unknown', () => {
      const [current] = months();
      Cache.set(`monthly_${current}`, [
        { name: 'Ann', wins: 1, losses: 0, totalPoints: 13, average: 13, elo: 1016 },
      ]);
      const container = document.createElement('div');
      renderHome(container, {});
      expect(container.querySelector('#home-month-movers').textContent.trim()).toBe('No ELO data');
    });

    it('uses the entire month rather than the latest tournament when replaying local matches', () => {
      const [current] = months();
      Store.setMatches([
        { ...match(1, 'Ann', 'Bob', 'Cid', 'Dan', 13, 10), date: `${current}-05` },
        { ...match(1, 'Ann', 'Bob', 'Cid', 'Dan', 13, 10), date: `${current}-12` },
      ]);
      const container = document.createElement('div');
      renderHome(container, {});
      const ann = [...container.querySelectorAll('#home-month-movers > div')]
        .find(row => row.textContent.includes('Ann'));
      expect(ann.textContent).toContain('+30.6');
      expect(ann.textContent).toContain('1031');
    });

    it('refreshes monthly movers after overview hydration', async () => {
      const [current, previous] = months();
      Store.setSupabaseConfig({ url: 'https://x.supabase.co', anonKey: 'k' });
      backend.pullMonthlyOverview = vi.fn(async (month) => {
        if (month === current) Cache.set(`monthly_${current}`, [
          { name: 'Ann', wins: 1, losses: 0, totalPoints: 13, average: 13, elo: 1016, previousElo: 1000 },
        ]);
        if (month === previous) Cache.set(`monthly_${previous}`, []);
      });
      const container = document.createElement('div');
      document.body.appendChild(container);
      renderHome(container, {});
      await vi.waitFor(() => expect(container.querySelector('#home-month-movers').textContent).toContain('+16.0'));
      container.remove();
    });
  });

  it('a stale render finishing its month fetch does not blank the newer render KPIs', async () => {
    Store.setSupabaseConfig({ url: 'https://x.supabase.co', anonKey: 'k' });
    const staleResolvers = [];
    backend.pullMonthlyOverview = vi.fn(() => new Promise(r => { staleResolvers.push(r); }));
    backend.ensureDayMatchesLoaded = vi.fn(() => new Promise(() => {}));

    // First render: route data not loaded yet.
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderHome(container, {});
    await vi.waitFor(() => expect(backend.pullMonthlyOverview).toHaveBeenCalled());
    // Route pull completes -> router re-renders into the same container.
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [y, m] = ym.split('-').map(Number);
    const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    Store.setTournamentsIndex([{ date: '2026-11-05', isComplete: true }]);
    Cache.set('home_matches', [
      match(1, 'Ann', 'Bob', 'Cid', 'Dan', 16, 9),
      match(2, 'Ann', 'Cid', 'Bob', 'Dan', 14, 11),
    ]);
    Cache.set(`monthly_${ym}`, [{ name: 'Ann', wins: 2, losses: 0, totalPoints: 30, average: 15, elo: 1020, previousElo: 1000 }]);
    Cache.set(`monthly_${prevYm}`, [{ name: 'Ann', wins: 1, losses: 0, totalPoints: 15, average: 15, elo: 1000 }]);
    renderHome(container, {});
    expect(kpiValues(container)['Latest winner']).toBe('Ann');

    // Stale first-render month fetch resolves afterwards.
    staleResolvers.forEach(r => r());
    await new Promise(r => setTimeout(r, 0));

    const byLabel = kpiValues(container);
    expect(byLabel['Latest winner']).toBe('Ann');
    expect(byLabel['Players last time']).toBe('4');
    expect(container.querySelector('#home-month-movers').textContent).toContain('+20.0');
    container.remove();
  });
});
