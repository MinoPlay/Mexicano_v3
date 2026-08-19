import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  createTournament,
  startTournament,
  triggerNewTournamentDayFile,
  triggerTournamentIndexEntry,
  getActiveTournament,
  loadTournamentByDate,
  deleteTournament,
} = vi.hoisted(() => ({
  createTournament: vi.fn(() => ({ tournamentDate: '2024-01-01', players: [] })),
  startTournament: vi.fn(),
  triggerNewTournamentDayFile: vi.fn(() => Promise.resolve()),
  triggerTournamentIndexEntry: vi.fn(),
  getActiveTournament: vi.fn(() => null),
  loadTournamentByDate: vi.fn(() => null),
  deleteTournament: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../js/services/tournament.js', () => ({
  createTournament,
  startTournament,
  triggerNewTournamentDayFile,
  triggerTournamentIndexEntry,
  getActiveTournament,
  loadTournamentByDate,
  deleteTournament,
}));

vi.mock('../../js/services/members.js', () => ({
  getRecentMembers: vi.fn(() => []),
}));

vi.mock('../../js/components/toast.js', () => ({
  showToast: vi.fn(),
}));

import { renderCreateTournament } from '../../js/pages/create-tournament.js';

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('create tournament - override existing date', () => {
  let container;

  function selectCount(n) {
    container.querySelector(`.player-count-option[data-count="${n}"]`).click();
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
    createTournament.mockClear();
    startTournament.mockClear();
    deleteTournament.mockClear();
    triggerNewTournamentDayFile.mockClear();
    triggerTournamentIndexEntry.mockClear();
    loadTournamentByDate.mockReturnValue({ tournamentDate: '2024-01-01', isCompleted: false });
    getActiveTournament.mockReturnValue(null);

    renderCreateTournament(container, {});
    selectCount(4);
    fill(['Alice', 'Bob', 'Carol', 'Dave']);
    container.querySelector('#tournament-date').value = '2024-01-01';
    container.querySelector('#start-btn').click();
  });

  it('shows a confirm dialog instead of just a toast when a tournament exists for the date', () => {
    const overlay = document.querySelector('.dialog-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toMatch(/already exists/i);
    expect(createTournament).not.toHaveBeenCalled();
  });

  it('does NOT create a tournament when the user cancels the override', async () => {
    document.querySelector('#dialog-cancel').click();
    await flush();
    expect(deleteTournament).not.toHaveBeenCalled();
    expect(createTournament).not.toHaveBeenCalled();
  });

  it('deletes the existing tournament then creates the new one when the user confirms the override', async () => {
    document.querySelector('#dialog-confirm').click();
    await flush();
    expect(deleteTournament).toHaveBeenCalledWith('2024-01-01');
    expect(createTournament).toHaveBeenCalledWith('2024-01-01', ['Alice', 'Bob', 'Carol', 'Dave'], null, null);
    expect(startTournament).toHaveBeenCalled();
  });
});
