import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache } from '../../js/cache.js';
import { State } from '../../js/state.js';
import { Store } from '../../js/store.js';
import { renderDoodle } from '../../js/pages/doodle.js';
import { getDoodle } from '../../js/services/doodle.js';
import * as backend from '../../js/services/backend.js';
import * as supabase from '../../js/services/supabase.js';
import { sendDoodleAlert } from '../../js/services/telegram.js';
import { showToast } from '../../js/components/toast.js';

vi.mock('../../js/services/local.js', () => ({
  writeDoodle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../js/services/telegram.js', () => ({
  sendDoodleAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../js/components/toast.js', () => ({
  showToast: vi.fn(),
}));

describe('Doodle editing permissions and staged changes', () => {
  let container;
  let cleanup;
  let invoke;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
    localStorage.clear();
    Cache.clear();
    State._listeners = {};
    State._routeBlockers = [];
    Store.setSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'test-key' });
    Store.setCurrentUser('Alice');
    Store.setAccessGrant({ role: 'admin', expires_at: '2026-11-12T12:00:00Z' });
    Store.setMembers(['Alice', 'Bob', 'Charlie', 'Diana']);
    Store.setDoodle('2026-11', [
      { name: 'Alice', selectedDates: ['2026-11-17'] },
      { name: 'Bob', selectedDates: ['2026-11-12'] },
      { name: 'Diana', selectedDates: ['2026-11-12'] },
    ]);
    vi.spyOn(backend, 'pullDoodleMonth').mockResolvedValue(true);
    vi.spyOn(backend, 'pullMonthlyOverview').mockResolvedValue([]);
    vi.spyOn(supabase, 'invalidateReadCache').mockImplementation(() => {});
    invoke = vi.spyOn(supabase, 'invokeFunction').mockResolvedValue({ saved: true });
    document.body.innerHTML = '<div id="doodle-page"></div>';
    container = document.getElementById('doodle-page');
    cleanup = null;
  });

  afterEach(() => {
    cleanup?.();
    document.body.innerHTML = '';
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function render() {
    cleanup = renderDoodle(container);
    await Promise.resolve();
  }

  function row(name) {
    return [...container.querySelectorAll('.doodle-table tbody tr')]
      .find(tr => tr.querySelector('.player-col').textContent === name);
  }

  function dateColumn(day) {
    return [...container.querySelectorAll('.doodle-table thead th')]
      .findIndex(th => parseInt(th.textContent, 10) === day);
  }

  function cell(name, day) {
    return row(name)?.children[dateColumn(day)]?.querySelector('.doodle-cell');
  }

  function total(day) {
    return container.querySelector('.doodle-total-row').children[dateColumn(day)].textContent;
  }

  it.each([
    ['admin', '2026-11-12T12:00:00Z', [true, true, true]],
    ['member', null, [true, false, false]],
    ['admin', '2026-11-10T12:00:00Z', [true, false, false]],
  ])('exposes edit permissions for role %s with expiry %s', (role, expires_at, expected) => {
    Store.setAccessGrant({ role, expires_at });
    expect(getDoodle(2026, 11).map(entry => entry.allowEdit)).toEqual(expected);
  });

  it('lets admins remove another player\'s last selection without hiding their row', async () => {
    await render();
    cell('Bob', 12).click();

    expect(cell('Bob', 12).classList.contains('selected')).toBe(false);
    expect(cell('Bob', 12).classList.contains('doodle-pending')).toBe(true);
    expect(cell('Bob', 12).classList.contains('readonly')).toBe(false);
    expect(total(12)).toBe('1');
    expect(document.getElementById('doodle-save-bar').style.display).toBe('flex');
    expect(Store.getDoodle('2026-11').find(entry => entry.name === 'Bob').selectedDates)
      .toEqual(['2026-11-12']);
  });

  it('shows all roster members and existing doodle players, including empty selections', async () => {
    Store.setDoodle('2026-11', [
      ...Store.getDoodle('2026-11'),
      { name: 'Guest', selectedDates: [] },
    ]);
    await render();

    expect([...container.querySelectorAll('.doodle-table tbody .player-col')].map(td => td.textContent))
      .toEqual(['Alice', 'Bob', 'Charlie', 'Diana', 'Guest']);

    cell('Charlie', 19).click();
    expect(row('Charlie').querySelectorAll('.selected')).toHaveLength(1);
    expect(row('Charlie').querySelectorAll('.doodle-pending')).toHaveLength(1);
    expect(total(19)).toBe('1');
  });

  it('saves multiple admin edits, preserves untouched remote changes, then alerts for edited players', async () => {
    await render();
    expect(row('Charlie')).toBeDefined();
    cell('Bob', 12).click();
    cell('Charlie', 19).click();
    backend.pullDoodleMonth.mockImplementationOnce(async () => {
      Store.setDoodle('2026-11', [
        { name: 'Alice', selectedDates: ['2026-11-17'] },
        { name: 'Bob', selectedDates: ['2026-11-12'] },
        { name: 'Diana', selectedDates: ['2026-11-24'] },
      ]);
    });
    let finishWrite;
    invoke.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));

    document.getElementById('doodle-save-btn').click();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const changes = [
      expect.objectContaining({
        playerName: 'Bob', yearMonth: '2026-11',
        selectedAdded: [], selectedRemoved: ['2026-11-12'],
      }),
      expect.objectContaining({
        playerName: 'Charlie', yearMonth: '2026-11',
        selectedAdded: ['2026-11-19'], selectedRemoved: [],
      }),
    ];
    expect(invoke).toHaveBeenCalledWith('domain-mutation', {
      operation: 'save_doodle',
      payload: {
        year_month: '2026-11',
        entries: [
          { name: 'Bob', selectedDates: [] },
          { name: 'Charlie', selectedDates: ['2026-11-19'] },
        ],
        changes,
      },
    });
    expect(Store.getDoodle('2026-11')).toEqual([
      { name: 'Alice', selectedDates: ['2026-11-17'] },
      { name: 'Bob', selectedDates: [] },
      { name: 'Diana', selectedDates: ['2026-11-24'] },
      { name: 'Charlie', selectedDates: ['2026-11-19'] },
    ]);
    expect(Store.getDoodleChangelog('2026-11')).toEqual([...changes].reverse());
    expect(sendDoodleAlert).not.toHaveBeenCalled();

    finishWrite({ saved: true });
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('Doodle saved'));
    expect(sendDoodleAlert.mock.calls).toEqual([
      ['Bob', '2026-11', [], ['2026-11-12']],
      ['Charlie', '2026-11', ['2026-11-19'], []],
    ]);
    expect(container.querySelectorAll('.doodle-pending')).toHaveLength(0);
    expect(document.getElementById('doodle-save-bar').style.display).toBe('none');
  });

  it('cancels admin edits for existing and previously empty players', async () => {
    await render();
    expect(row('Charlie')).toBeDefined();
    cell('Bob', 12).click();
    cell('Charlie', 19).click();
    cell('Alice', 17).click();
    document.getElementById('doodle-cancel-btn').click();

    expect(cell('Alice', 17).classList.contains('selected')).toBe(true);
    expect(cell('Bob', 12).classList.contains('selected')).toBe(true);
    expect(cell('Charlie', 19).classList.contains('selected')).toBe(false);
    expect(total(12)).toBe('2');
    expect(total(19)).toBe('0');
    expect(container.querySelectorAll('.doodle-pending')).toHaveLength(0);
    expect(document.getElementById('doodle-save-bar').style.display).toBe('none');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('cancels a selection when the edited player has no saved entry', async () => {
    Store.setCurrentUser('Charlie');
    await render();
    cell('Charlie', 19).click();
    document.getElementById('doodle-cancel-btn').click();

    expect(cell('Charlie', 19).classList.contains('selected')).toBe(false);
    expect(container.querySelectorAll('.doodle-pending')).toHaveLength(0);
    expect(document.getElementById('doodle-save-bar').style.display).toBe('none');
  });

  it.each([
    ['member', null],
    ['admin', '2026-11-10T12:00:00Z'],
  ])('keeps other players read-only for role %s with expiry %s', async (role, expires_at) => {
    Store.setAccessGrant({ role, expires_at });
    await render();
    expect(row('Charlie')).toBeUndefined();
    cell('Bob', 12).click();
    expect(cell('Bob', 12).classList.contains('readonly')).toBe(true);
    expect(cell('Bob', 12).classList.contains('selected')).toBe(true);
    expect(document.getElementById('doodle-save-bar').style.display).toBe('none');

    cell('Alice', 17).click();
    expect(cell('Alice', 17).classList.contains('selected')).toBe(false);
    expect(cell('Alice', 17).classList.contains('doodle-pending')).toBe(true);
  });

  it('does not replay untouched players when saving the current user', async () => {
    Store.setAccessGrant({ role: 'member' });
    await render();
    cell('Alice', 19).click();
    backend.pullDoodleMonth.mockImplementationOnce(async () => {
      Store.setDoodle('2026-11', [
        { name: 'Alice', selectedDates: ['2026-11-17'] },
        { name: 'Bob', selectedDates: ['2026-11-24'] },
        { name: 'Diana', selectedDates: ['2026-11-12'] },
      ]);
    });
    document.getElementById('doodle-save-btn').click();

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][1].payload.entries).toEqual([
      { name: 'Alice', selectedDates: ['2026-11-17', '2026-11-19'] },
    ]);
    expect(Store.getDoodle('2026-11').find(entry => entry.name === 'Bob').selectedDates)
      .toEqual(['2026-11-24']);
  });

  it('keeps past and non-playable dates uneditable for admins', async () => {
    await render();
    const calendarCells = [...container.querySelectorAll('.doodle-cal-cell')];
    calendarCells.find(day => day.textContent === '10').click();
    calendarCells.find(day => day.textContent === '11').click();

    expect(container.querySelectorAll('.doodle-pending')).toHaveLength(0);
    expect(document.getElementById('doodle-save-bar').style.display).toBe('none');
    expect(invoke).not.toHaveBeenCalled();
  });
});
