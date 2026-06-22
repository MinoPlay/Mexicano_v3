import { describe, it, expect } from 'vitest';
import {
  shouldShowConfirmationPopup,
  buildConfirmationAlertMessage,
} from '../../js/pages/home.js';

// ─── shouldShowConfirmationPopup ───

describe('shouldShowConfirmationPopup', () => {
  const tournament = {
    tournamentDate: '2024-06-22',
    players: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
    isCompleted: false,
  };

  it('returns false when no active tournament', () => {
    expect(shouldShowConfirmationPopup(null, 'Alice', false)).toBe(false);
  });

  it('returns false when current user is empty', () => {
    expect(shouldShowConfirmationPopup(tournament, '', false)).toBe(false);
  });

  it('returns false when current user is not in tournament players', () => {
    expect(shouldShowConfirmationPopup(tournament, 'Charlie', false)).toBe(false);
  });

  it('returns false when user already confirmed', () => {
    expect(shouldShowConfirmationPopup(tournament, 'Alice', true)).toBe(false);
  });

  it('returns true when tournament active, user is player, not yet confirmed', () => {
    expect(shouldShowConfirmationPopup(tournament, 'Alice', false)).toBe(true);
  });

  it('returns true for case-insensitive name match', () => {
    expect(shouldShowConfirmationPopup(tournament, 'alice', false)).toBe(true);
    expect(shouldShowConfirmationPopup(tournament, 'ALICE', false)).toBe(true);
  });

  it('returns false when tournament is completed', () => {
    const completed = { ...tournament, isCompleted: true };
    expect(shouldShowConfirmationPopup(completed, 'Alice', false)).toBe(false);
  });
});

// ─── buildConfirmationAlertMessage ───

describe('buildConfirmationAlertMessage', () => {
  it('builds correct WhatsApp message', () => {
    expect(buildConfirmationAlertMessage('Alice', '2024-06-22'))
      .toBe('🎾 Alice confirmed attendance for tournament on 2024-06-22');
  });

  it('uses given player name verbatim', () => {
    expect(buildConfirmationAlertMessage('João', '2025-01-15'))
      .toBe('🎾 João confirmed attendance for tournament on 2025-01-15');
  });
});
