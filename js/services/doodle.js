/**
 * Doodle scheduling service.
 * Manages player date availability per month.
 */
import { Store } from '../store.js';
import { State } from '../state.js';
import { writeDoodle } from './local.js';
import { sendDoodleAlert } from './whatsapp.js';

export function getAllDatesInMonth(year, month) {
  const dates = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dow = date.getDay();
    // Only include Tuesdays (2) and Thursdays (4)
    if (dow !== 2 && dow !== 4) continue;
    const mm = String(month).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    dates.push(`${year}-${mm}-${dd}`);
  }
  return dates;
}

export function getDoodle(year, month) {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const entries = Store.getDoodle(yearMonth);
  const allDates = getAllDatesInMonth(year, month);
  const currentUser = Store.getCurrentUser();

  return entries.map(entry => {
    const selected = {};
    for (const date of allDates) {
      selected[date] = !!(entry.selectedDates && entry.selectedDates.includes(date));
    }
    return {
      name: entry.name,
      selected,
      allowEdit: entry.name === currentUser
    };
  });
}

export function saveDoodle(playerName, year, month, selectedDates) {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const allDates = getAllDatesInMonth(year, month);

  // Validate dates are in the month
  for (const d of selectedDates) {
    if (!allDates.includes(d)) {
      throw new Error(`Date "${d}" is not in ${yearMonth}`);
    }
  }

  const entries = Store.getDoodle(yearMonth);
  const idx = entries.findIndex(e => e.name === playerName);
  const previousDates = idx >= 0 && Array.isArray(entries[idx].selectedDates)
    ? [...entries[idx].selectedDates]
    : [];
  const normalizedSelectedDates = [...selectedDates].sort();
  const entry = { name: playerName, selectedDates: normalizedSelectedDates };

  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }

  Store.setDoodle(yearMonth, entries);
  writeDoodle(year, month, entries).catch(e => console.warn('[local] doodle write failed:', e));
  const previousSet = new Set(previousDates);
  const nextSet = new Set(normalizedSelectedDates);
  const selectedAdded = normalizedSelectedDates.filter(d => !previousSet.has(d));
  const selectedRemoved = previousDates.filter(d => !nextSet.has(d)).sort();
  logDoodleChange(playerName, year, month, selectedAdded, selectedRemoved);
  sendDoodleAlert(playerName, yearMonth, selectedAdded, selectedRemoved);
  State.emit('doodle-changed', { year, month });
}

export function deleteDoodle(playerName, year, month) {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const entries = Store.getDoodle(yearMonth);
  const removedEntry = entries.find(e => e.name === playerName);
  const filtered = entries.filter(e => e.name !== playerName);
  Store.setDoodle(yearMonth, filtered);
  const selectedRemoved = Array.isArray(removedEntry?.selectedDates) ? [...removedEntry.selectedDates].sort() : [];
  logDoodleChange(playerName, year, month, [], selectedRemoved);
  sendDoodleAlert(playerName, yearMonth, [], selectedRemoved);
  State.emit('doodle-changed', { year, month });
}

export function logDoodleChange(playerName, year, month, selectedAdded = [], selectedRemoved = []) {
  if (!selectedAdded.length && !selectedRemoved.length) return;
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const changelog = Store.getDoodleChangelog(yearMonth);
  changelog.unshift({
    playerName,
    yearMonth,
    year,
    month,
    selectedAdded,
    selectedRemoved,
    timestamp: new Date().toISOString()
  });
  Store.setDoodleChangelog(yearMonth, changelog);
}

export function getChangelog(year, month) {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  return Store.getDoodleChangelog(yearMonth);
}

/**
 * Load doodle data for a given month from the local dev server (if available)
 * and update Store + emit doodle-changed so the UI re-renders.
 * No-op when not running on the local dev server.
 */
export async function syncDoodleFromLocal(year, month) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  try {
    const r = await fetch(`/api/local-data/doodle?yearMonth=${ym}`);
    if (!r.ok) return;
    const data = await r.json();
    if (!Array.isArray(data)) return;
    const current = Store.getDoodle(ym);
    if (JSON.stringify(current) !== JSON.stringify(data)) {
      Store.setDoodle(ym, data);
      State.emit('doodle-changed', { year, month });
    }
  } catch { /* not on local dev server */ }
}
