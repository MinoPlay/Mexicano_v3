/**
 * Doodle scheduling service.
 * Manages player date availability per month.
 */
import { Store } from '../store.js';
import { State } from '../state.js';

export function getAllDatesInMonth(year, month) {
  const dates = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
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
  const entry = { name: playerName, selectedDates };

  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }

  Store.setDoodle(yearMonth, entries);
  logDoodleChange(playerName, year, month, selectedDates);
  State.emit('doodle-changed', { year, month });
}

export function deleteDoodle(playerName, year, month) {
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const entries = Store.getDoodle(yearMonth);
  const filtered = entries.filter(e => e.name !== playerName);
  Store.setDoodle(yearMonth, filtered);
  logDoodleChange(playerName, year, month, []);
  State.emit('doodle-changed', { year, month });
}

export function logDoodleChange(playerName, year, month, selectedDates) {
  const changelog = Store.getChangelog();
  changelog.unshift({
    playerName,
    year,
    month,
    selectedDates,
    timestamp: new Date().toISOString()
  });
  Store.setChangelog(changelog.slice(0, 20));
}

export function getChangelog() {
  return Store.getChangelog().slice(0, 20);
}
