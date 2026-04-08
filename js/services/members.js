/**
 * Member management service.
 * CRUD operations for the player roster.
 */
import { Store } from '../store.js';
import { State } from '../state.js';

export function getMembers() {
  return Store.getMembers();
}

/**
 * Returns players who participated in matches during the current and previous
 * calendar month. Falls back to the manually-managed roster if no match data
 * exists for those months.
 */
export function getRecentMembers() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const prevDate = new Date(curYear, curMonth - 2, 1);
  const prevYear = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth() + 1;

  const curPrefix  = `${curYear}-${String(curMonth).padStart(2, '0')}`;
  const prevPrefix = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  const playerSet = new Set();
  for (const m of Store.getMatches()) {
    if (!m.date) continue;
    if (m.date.startsWith(curPrefix) || m.date.startsWith(prevPrefix)) {
      [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name]
        .filter(Boolean)
        .forEach(name => playerSet.add(name));
    }
  }

  if (playerSet.size === 0) return Store.getMembers();
  return [...playerSet].sort((a, b) => a.localeCompare(b));
}

export function addMember(name) {
  if (typeof name !== 'string') throw new Error('Name must be a string');
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 50) {
    throw new Error('Name must be between 1 and 50 characters');
  }
  const members = getMembers();
  const duplicate = members.some(m => m.toLowerCase() === trimmed.toLowerCase());
  if (duplicate) {
    throw new Error(`Member "${trimmed}" already exists`);
  }
  members.push(trimmed);
  Store.setMembers(members);
  State.emit('members-changed', members);
  return members;
}

export function removeMember(name) {
  const members = getMembers();
  const idx = members.findIndex(m => m.toLowerCase() === name.toLowerCase());
  if (idx === -1) throw new Error(`Member "${name}" not found`);
  members.splice(idx, 1);
  Store.setMembers(members);
  State.emit('members-changed', members);
  return members;
}

export function updateMember(oldName, newName) {
  if (typeof newName !== 'string') throw new Error('Name must be a string');
  const trimmed = newName.trim();
  if (trimmed.length < 1 || trimmed.length > 50) {
    throw new Error('Name must be between 1 and 50 characters');
  }
  const members = getMembers();
  const idx = members.findIndex(m => m.toLowerCase() === oldName.toLowerCase());
  if (idx === -1) throw new Error(`Member "${oldName}" not found`);

  if (trimmed.toLowerCase() !== oldName.toLowerCase()) {
    const duplicate = members.some(m => m.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) throw new Error(`Member "${trimmed}" already exists`);
  }

  members[idx] = trimmed;
  Store.setMembers(members);
  State.emit('members-changed', members);
  return members;
}
