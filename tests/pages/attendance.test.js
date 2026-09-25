import { beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../js/store.js';
import { renderAttendance } from '../../js/pages/attendance.js';

describe('Attendance page rendering', () => {
  beforeEach(() => {
    localStorage.clear();
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
    [...container.querySelectorAll('.tab')]
      .find((button) => button.textContent === 'Statistics')
      .click();

    const rows = [...container.querySelectorAll('tbody tr')]
      .map((row) => [...row.children].map((cell) => cell.textContent));
    expect(rows[0]).toEqual(['1', 'A', '2', '2', '100.0%']);
    expect(rows.find((row) => row[1] === 'E')).toEqual(['5', 'E', '1', '2', '50.0%']);
  });
});
