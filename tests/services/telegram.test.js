import { describe, it, expect } from 'vitest';
import { buildDoodleAlertText, buildConfirmationText } from '../../js/services/telegram.js';

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
