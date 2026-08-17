import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../js/services/tournament.js', () => ({
  createTournament: vi.fn(),
  startTournament: vi.fn(),
  triggerNewTournamentDayFile: vi.fn(),
  triggerTournamentIndexEntry: vi.fn(),
  getActiveTournament: vi.fn(() => null),
  loadTournamentByDate: vi.fn(() => null),
}));

vi.mock('../../js/services/members.js', () => ({
  getRecentMembers: vi.fn(() => ['Alice', 'Bob']),
}));

vi.mock('../../js/components/toast.js', () => ({
  showToast: vi.fn(),
}));

import { resizePlayerNames, renderCreateTournament } from '../../js/pages/create-tournament.js';

describe('resizePlayerNames', () => {
  it('keeps the top N names when shrinking 12 -> 8', () => {
    const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12'];
    expect(resizePlayerNames(names, 8)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  });

  it('keeps all names and pads with blanks when growing 12 -> 16', () => {
    const names = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', '', '', '', '', '', ''];
    expect(resizePlayerNames(names, 16)).toEqual([
      'P1', 'P2', 'P3', 'P4', 'P5', 'P6', '', '', '', '', '', '', '', '', '', '',
    ]);
  });

  it('pads from empty when nothing typed yet', () => {
    expect(resizePlayerNames([], 4)).toEqual(['', '', '', '']);
  });

  it('is a no-op when the count does not change', () => {
    expect(resizePlayerNames(['A', 'B', '', ''], 4)).toEqual(['A', 'B', '', '']);
  });
});

describe('create tournament player count switching', () => {
  let container;

  function selectCount(n) {
    container.querySelector(`.player-count-option[data-count="${n}"]`).click();
  }

  function slotValues() {
    return Array.from(container.querySelectorAll('#player-slots input')).map(i => i.value);
  }

  function fill(values) {
    const inputs = container.querySelectorAll('#player-slots input');
    values.forEach((v, i) => {
      inputs[i].value = v;
      inputs[i].dispatchEvent(new Event('input'));
    });
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    renderCreateTournament(container, {});
  });

  it('keeps the first 8 players when switching 12 -> 8', () => {
    selectCount(12);
    fill(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12']);
    selectCount(8);
    expect(slotValues()).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  });

  it('keeps all players and adds blank slots when switching 12 -> 16', () => {
    selectCount(12);
    fill(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12']);
    selectCount(16);
    expect(slotValues()).toEqual([
      'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', '', '', '', '',
    ]);
  });

  it('restores dropped names when switching back up after shrinking', () => {
    selectCount(8);
    fill(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    selectCount(4);
    expect(slotValues()).toEqual(['A', 'B', 'C', 'D']);
    selectCount(8);
    expect(slotValues()).toEqual(['A', 'B', 'C', 'D', '', '', '', '']);
  });

  it('shift-down moves a name only one slot after repeated count switches', () => {
    selectCount(8);
    fill(['A', 'B', '', '', '', '', '', '']);
    selectCount(12);
    selectCount(8);
    container.querySelectorAll('.player-slot-shift-btn.shift-down')[0].click();
    expect(slotValues()).toEqual(['', 'A', 'B', '', '', '', '', '']);
  });
});
