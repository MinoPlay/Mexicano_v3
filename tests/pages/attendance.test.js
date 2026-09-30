import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureParticipationLoaded = vi.fn(async () => {
  const { Cache: cache } = await import('../../js/cache.js');
  cache.set('participation_2026-08', [{ date: '2026-08-20', players: ['Z'] }]);
  cache.set('supabase_res_participation_all', true);
});
vi.mock('../../js/services/backend.js', () => ({ ensureParticipationLoaded }));
import { Store } from '../../js/store.js';
import { Cache } from '../../js/cache.js';
import { renderAttendance } from '../../js/pages/attendance.js';

describe('Attendance page rendering', () => {
  beforeEach(() => {
    localStorage.clear();
    Cache.clear();
    document.body.innerHTML = '';
    Store.setMatches([{
      date: '2026-09-10',
      team1Player1Name: 'A',
      team1Player2Name: 'B',
      team2Player1Name: 'C',
      team2Player2Name: 'D',
      scoreTeam1: 13,
      scoreTeam2: 10,
    }]);
    Store.setManualAttendance([{
      date: '2026-09-12',
      players: ['A', 'E'],
      note: 'Training',
    }]);
  });

  it('renders tournament and manual attendance in the calendar', () => {
    const container = document.createElement('div');
    renderAttendance(container);

    const attendedDays = [...container.querySelectorAll('.attendance-day.has-tournament')];
    expect(attendedDays).toHaveLength(2);
    expect(attendedDays.map((cell) => cell.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      '10 4 🏸',
      '12 2 🏸',
    ]);
  });

  it('maps attendance statistics into visible table columns', () => {
    const container = document.createElement('div');
    renderAttendance(container);
    const rows = [...container.querySelectorAll('.data-table tbody tr')]
      .map((row) => [...row.children].map((cell) => cell.textContent));
    expect(rows[0]).toEqual(['1', 'A', '2', '2', '100.0%']);
    expect(rows.find((row) => row[1] === 'E')).toEqual(['5', 'E', '1', '2', '50.0%']);
  });

  it('renders from participation rows alone, without any match history', () => {
    Store.setMatches([]);
    Cache.set('participation_2026-09', [{ date: '2026-09-10', players: ['A', 'B', 'C', 'D'] }]);
    const container = document.createElement('div');
    renderAttendance(container);

    const attendedDays = [...container.querySelectorAll('.attendance-day.has-tournament')];
    expect(attendedDays.map((cell) => cell.textContent.replace(/\s+/g, ' ').trim())).toEqual([
      '10 4 🏸',
      '12 2 🏸',
    ]);
    const rows = [...container.querySelectorAll('.data-table tbody tr')]
      .map((row) => [...row.children].map((cell) => cell.textContent));
    expect(rows[0]).toEqual(['1', 'A', '2', '2', '100.0%']);
  });

  it('loads full participation when only some months are cached', async () => {
    Store.setMatches([]);
    Store.setSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'anon' });
    Cache.set('participation_2026-09', [{ date: '2026-09-10', players: ['A'] }]);
    const container = document.createElement('div');
    renderAttendance(container);

    expect(container.textContent).toContain('Loading');
    await vi.waitFor(() => expect(container.querySelector('.data-table')).not.toBeNull());
    expect(ensureParticipationLoaded).toHaveBeenCalled();
    const names = [...container.querySelectorAll('.data-table tbody tr')].map((row) => row.children[1].textContent);
    expect(names).toContain('Z');
  });
});
