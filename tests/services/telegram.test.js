import { describe, it, expect } from 'vitest';
import {
  buildDoodleAlertText,
  buildConfirmationText,
  buildTournamentCreatedText,
  buildTournamentCompletedText,
} from '../../js/services/telegram.js';

describe('buildDoodleAlertText', () => {
  it('lists added and removed dates', () => {
    expect(buildDoodleAlertText('Alice', '2026-07', ['2026-07-01', '2026-07-08'], ['2026-07-15']))
      .toBe('🎾 Doodle update — Alice (2026-07)\n✅ Added: 2026-07-01, 2026-07-08\n❌ Removed: 2026-07-15');
  });

  it('uses "none" when a side is empty', () => {
    expect(buildDoodleAlertText('Bob', '2026-07', [], ['2026-07-15']))
      .toBe('🎾 Doodle update — Bob (2026-07)\n✅ Added: none\n❌ Removed: 2026-07-15');
  });
});

describe('buildConfirmationText', () => {
  it('builds the confirmation message', () => {
    expect(buildConfirmationText('Alice', '2024-06-22'))
      .toBe('🎾 Alice confirmed attendance for tournament on 2024-06-22');
  });
});

describe('buildTournamentCreatedText', () => {
  it('lists date, code and starting brackets', () => {
    const brackets = [
      { team1: ['Alice', 'Bob'], team2: ['Carol', 'Dave'] },
      { team1: ['Eve', 'Frank'], team2: ['Grace', 'Heidi'] },
    ];
    expect(buildTournamentCreatedText('2026-07-15', 'PADEL', brackets)).toBe(
      '🎾 New tournament — 2026-07-15\n🔑 Code: PADEL\nStarting brackets:\n' +
      'Court 1: Alice & Bob vs Carol & Dave\n' +
      'Court 2: Eve & Frank vs Grace & Heidi'
    );
  });

  it('uses "none" when no access code', () => {
    const brackets = [{ team1: ['Alice', 'Bob'], team2: ['Carol', 'Dave'] }];
    expect(buildTournamentCreatedText('2026-07-15', null, brackets)).toBe(
      '🎾 New tournament — 2026-07-15\n🔑 Code: none\nStarting brackets:\n' +
      'Court 1: Alice & Bob vs Carol & Dave'
    );
  });
});

describe('buildTournamentCompletedText', () => {
  it('lists date and final ranking', () => {
    const ranked = [
      { rank: 1, name: 'Alice', totalPoints: 45 },
      { rank: 2, name: 'Bob', totalPoints: 40 },
      { rank: 2, name: 'Carol', totalPoints: 40 },
    ];
    expect(buildTournamentCompletedText('2026-07-15', ranked)).toBe(
      '🏆 Tournament complete — 2026-07-15\nFinal ranking:\n' +
      '1. Alice — 45 pts\n' +
      '2. Bob — 40 pts\n' +
      '2. Carol — 40 pts'
    );
  });
});
