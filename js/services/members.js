/**
 * Member management service.
 * CRUD operations for the player roster.
 */
import { Store } from '../store.js';
import { State } from '../state.js';

export function getMembers() {
  return Store.getMembers();
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
