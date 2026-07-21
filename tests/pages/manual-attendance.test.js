import { describe, it, expect } from 'vitest';
import { computeAttendance } from '../../js/services/statistics.js';
import {
  getAttendanceStatistics,
  buildMonthParticipation,
  upsertManualEntry,
} from '../../js/services/attendance.js';

const TODAY = new Date('2026-06-15');

// ── Stats page attendance (players_overview-driven) merges manual entries ──
describe('computeAttendance with manual entries', () => {
  const raw = {
    '2026-06': [
      { Name: 'Jeremy', ELO: [{ Date: '2026-06-02', ELO: 1251 }, { Date: '2026-06-11', ELO: 1270 }] },
    ],
  };

  it('adds manual date players to attendance count', () => {
    const manual = [{ date: '2026-06-20', players: ['Jeremy', 'Ana'] }];
    expect(computeAttendance(raw, 'latest', TODAY, manual)).toEqual([
      { name: 'Jeremy', attendance: 3 },
      { name: 'Ana', attendance: 1 },
    ]);
  });

  it('respects the cutoff window for manual entries', () => {
    // filter 30 -> cutoff 2026-05-16; manual 2026-05-10 excluded
    const manual = [
      { date: '2026-05-10', players: ['Ana'] },
      { date: '2026-05-20', players: ['Ana'] },
    ];
    const raw30 = { '2026-05': [], '2026-06': raw['2026-06'] };
    expect(computeAttendance(raw30, '30', TODAY, manual)).toEqual([
      { name: 'Jeremy', attendance: 2 },
      { name: 'Ana', attendance: 1 },
    ]);
  });

  it('ignores manual months outside the filter window', () => {
    const manual = [{ date: '2026-01-05', players: ['Ana'] }];
    expect(computeAttendance(raw, 'latest', TODAY, manual)).toEqual([
      { name: 'Jeremy', attendance: 2 },
    ]);
  });
});

// ── /attendance page stats (matches-driven) merges manual entries ──
describe('getAttendanceStatistics with manual entries', () => {
  const matches = [
    { date: '2026-06-02', team1Player1Name: 'Jeremy', team1Player2Name: 'Ana', team2Player1Name: 'Bob', team2Player2Name: 'Zoe' },
  ];

  it('manual date counts as a session and per-player attendance', () => {
    const manual = [{ date: '2026-06-20', players: ['Jeremy', 'Ana'] }];
    const stats = getAttendanceStatistics(matches, null, manual);
    const jeremy = stats.find(s => s.playerName === 'Jeremy');
    expect(jeremy.attendanceCount).toBe(2);
    expect(jeremy.totalTournaments).toBe(2); // 2026-06-02 tournament + 2026-06-20 manual
    const bob = stats.find(s => s.playerName === 'Bob');
    expect(bob.attendanceCount).toBe(1);
    expect(bob.totalTournaments).toBe(2);
  });

  it('merges players when manual date equals a tournament date', () => {
    const manual = [{ date: '2026-06-02', players: ['Newbie'] }];
    const stats = getAttendanceStatistics(matches, null, manual);
    expect(stats.find(s => s.playerName === 'Newbie').attendanceCount).toBe(1);
    // still only one session
    expect(stats[0].totalTournaments).toBe(1);
  });
});

// ── Doodle Player Overview participation merge ──
describe('buildMonthParticipation', () => {
  const matches = [
    { date: '2026-06-02', team1Player1Name: 'Jeremy', team1Player2Name: 'Ana', team2Player1Name: 'Bob', team2Player2Name: 'Zoe' },
  ];

  it('includes manual dates as tournament dates with their players', () => {
    const manual = [{ date: '2026-06-20', players: ['Jeremy', 'New'] }];
    const { datePlayerMap, tournamentDates } = buildMonthParticipation(matches, manual, '2026-06');
    expect(tournamentDates).toEqual(['2026-06-02', '2026-06-20']);
    expect([...datePlayerMap['2026-06-20']].sort()).toEqual(['Jeremy', 'New']);
  });

  it('ignores manual dates from other months', () => {
    const manual = [{ date: '2026-05-20', players: ['X'] }];
    const { tournamentDates } = buildMonthParticipation(matches, manual, '2026-06');
    expect(tournamentDates).toEqual(['2026-06-02']);
  });
});

// ── Validation on add ──
describe('upsertManualEntry', () => {
  const tournamentDates = ['2026-06-02'];

  it('rejects a date that is already a tournament date', () => {
    expect(() => upsertManualEntry([], { date: '2026-06-02', players: ['A'] }, tournamentDates))
      .toThrow(/tournament/i);
  });

  it('rejects empty player list', () => {
    expect(() => upsertManualEntry([], { date: '2026-06-20', players: [] }, tournamentDates))
      .toThrow(/player/i);
  });

  it('dedupes players, trims blanks, sorts entries by date', () => {
    let entries = [{ date: '2026-06-25', players: ['Z'] }];
    entries = upsertManualEntry(entries, { date: '2026-06-20', players: ['B', 'B', ' ', 'A'] }, tournamentDates);
    expect(entries.map(e => e.date)).toEqual(['2026-06-20', '2026-06-25']);
    expect(entries[0].players).toEqual(['A', 'B']);
  });

  it('replaces players when the same date is added again', () => {
    let entries = [{ date: '2026-06-20', players: ['A'] }];
    entries = upsertManualEntry(entries, { date: '2026-06-20', players: ['C', 'D'] }, tournamentDates);
    expect(entries).toHaveLength(1);
    expect(entries[0].players).toEqual(['C', 'D']);
  });
});
