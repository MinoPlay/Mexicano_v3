import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../js/store.js';
import { Cache } from '../../js/cache.js';

const saveManualAttendance = vi.fn(async () => {});
const ensureAttendanceEditData = vi.fn(async () => {
  Store.setMembers(['Anna', 'Ben']);
  Store.setManualAttendance([{ date: '2026-01-05', players: ['Anna'] }]);
});
vi.mock('../../js/services/backend.js', () => ({ saveManualAttendance, ensureAttendanceEditData }));

const { showManualAttendanceDialog } = await import('../../js/components/manual-attendance-dialog.js');

describe('manual attendance dialog', () => {
  beforeEach(() => {
    Cache.clear();
    document.body.innerHTML = '';
    saveManualAttendance.mockClear();
  });

  it('loads existing entries before saving so the full-list save never drops history', async () => {
    await showManualAttendanceDialog();

    expect(ensureAttendanceEditData).toHaveBeenCalled();
    document.querySelector('#mad-date').value = '2026-02-02';
    document.querySelector('.mad-player-input').value = 'Ben';
    document.querySelector('#mad-save').click();
    await vi.waitFor(() => expect(saveManualAttendance).toHaveBeenCalled());

    expect(saveManualAttendance).toHaveBeenCalledWith([
      { date: '2026-01-05', players: ['Anna'] },
      { date: '2026-02-02', players: ['Ben'] },
    ]);
  });
});
