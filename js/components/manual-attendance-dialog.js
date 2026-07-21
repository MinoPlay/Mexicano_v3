/**
 * Popup dialog to record manual (no-tournament) attendance for a single date.
 * Invoked from Settings → Add Attendance. Writes data/attendance_manual.json
 * via Store.setManualAttendance (which schedules a GitHub push).
 */
import { Store } from '../store.js';
import { getMembers } from '../services/members.js';
import { upsertManualEntry } from '../services/attendance.js';
import { showToast } from './toast.js';

/** All dates in the store that already have a tournament (matches). */
function tournamentDates() {
  const set = new Set();
  for (const m of Store.getMatches()) {
    if (m.date) set.add(m.date);
  }
  return [...set];
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function showManualAttendanceDialog() {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '9999',
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'var(--bg-card, #fff)',
    color: 'var(--text-primary, #111)',
    border: '1px solid var(--border, #e0e0e0)',
    borderRadius: '12px',
    padding: '20px 24px',
    minWidth: '280px',
    maxWidth: '400px',
    width: '100%',
    maxHeight: '85vh',
    overflow: 'auto',
    boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  });

  const members = getMembers().slice().sort((a, b) => a.localeCompare(b));
  const memberByLower = new Map(members.map(n => [n.toLowerCase(), n]));

  card.innerHTML = `
    <h3 class="card-title mb-sm" style="margin-top:0;">Add Attendance</h3>
    <p class="text-secondary text-sm mb-md">Record attendance for a day without a tournament. Only affects Stats → Attendance and the Doodle Player Overview.</p>
    <label class="text-sm text-secondary" for="mad-date">Date</label>
    <input type="date" id="mad-date" class="input mb-sm" value="${todayISO()}" style="width:100%;margin-bottom:var(--space-sm);" />
    <div class="text-sm text-secondary mb-xs">Players present</div>
    <div id="mad-rows" style="display:flex;flex-direction:column;gap:var(--space-sm);margin-bottom:var(--space-md);"></div>
    <div class="flex gap-sm">
      <button class="btn btn-ghost" id="mad-cancel" style="flex:1;">Cancel</button>
      <button class="btn btn-success" id="mad-save" style="flex:1;">Save</button>
    </div>
  `;

  const rowsBox = card.querySelector('#mad-rows');

  /** Names already picked in other rows (to hide from suggestions). */
  function pickedElsewhere(exceptInput) {
    return new Set(
      [...card.querySelectorAll('.mad-player-input')]
        .filter(i => i !== exceptInput)
        .map(i => i.value.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  function closeAllPanels() {
    card.querySelectorAll('.mad-panel').forEach(p => { p.style.display = 'none'; });
  }

  function addRow(value = '', after = null) {
    const row = document.createElement('div');
    row.className = 'mad-row';
    row.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    row.innerHTML = `
      <div style="display:flex;align-items:center;gap:var(--space-xs);">
        <input type="text" class="input mad-player-input" placeholder="Type a name…"
          autocomplete="off" role="combobox" aria-expanded="false" style="flex:1;" />
        <button type="button" class="btn btn-ghost btn-sm mad-remove" title="Remove" aria-label="Remove">−</button>
        <button type="button" class="btn btn-ghost btn-sm mad-add" title="Add another" aria-label="Add another">＋</button>
      </div>
      <div class="mad-panel" role="listbox" style="
        display:none;border:1px solid var(--border,#3a4252);border-radius:8px;
        background:var(--bg-elevated,var(--bg-card,#252b3a));max-height:180px;overflow-y:auto;
        box-shadow:0 6px 18px rgba(0,0,0,0.25);"></div>
    `;

    const input = row.querySelector('.mad-player-input');
    const panel = row.querySelector('.mad-panel');
    input.value = value;
    let activeIdx = -1;

    function renderOptions() {
      const q = input.value.trim().toLowerCase();
      const taken = pickedElsewhere(input);
      const matches = members.filter(n =>
        !taken.has(n.toLowerCase()) && (!q || n.toLowerCase().includes(q))
      );
      activeIdx = -1;
      if (!matches.length) {
        panel.innerHTML = `<div class="text-secondary text-sm" style="padding:8px 12px;">No matches</div>`;
      } else {
        panel.innerHTML = matches.map((n, i) => `
          <div class="mad-option" data-name="${n}" data-idx="${i}" role="option"
            style="padding:8px 12px;cursor:pointer;font-size:14px;">${n}</div>
        `).join('');
      }
    }

    function openPanel() {
      closeAllPanels();
      renderOptions();
      panel.style.display = 'block';
      input.setAttribute('aria-expanded', 'true');
    }
    function closePanel() {
      panel.style.display = 'none';
      input.setAttribute('aria-expanded', 'false');
    }
    function highlight(idx) {
      const opts = [...panel.querySelectorAll('.mad-option')];
      opts.forEach(o => { o.style.background = ''; });
      activeIdx = idx;
      if (idx >= 0 && opts[idx]) {
        opts[idx].style.background = 'var(--color-primary-soft, rgba(59,130,246,0.25))';
        opts[idx].scrollIntoView({ block: 'nearest' });
      }
    }
    function selectName(name) {
      input.value = name;
      closePanel();
    }

    input.addEventListener('focus', openPanel);
    input.addEventListener('input', () => { openPanel(); });
    input.addEventListener('keydown', (e) => {
      const opts = [...panel.querySelectorAll('.mad-option')];
      if (e.key === 'ArrowDown') { e.preventDefault(); if (panel.style.display === 'none') openPanel(); highlight(Math.min(activeIdx + 1, opts.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(activeIdx - 1, 0)); }
      else if (e.key === 'Enter') {
        if (activeIdx >= 0 && opts[activeIdx]) { e.preventDefault(); selectName(opts[activeIdx].dataset.name); }
      } else if (e.key === 'Escape') { closePanel(); }
    });
    panel.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.mad-option');
      if (opt) { e.preventDefault(); selectName(opt.dataset.name); }
    });
    panel.addEventListener('mouseover', (e) => {
      const opt = e.target.closest('.mad-option');
      if (opt) highlight(Number(opt.dataset.idx));
    });
    input.addEventListener('blur', () => {
      setTimeout(() => {
        closePanel();
        // Strict: only keep an exact member name; drop any free text.
        input.value = memberByLower.get(input.value.trim().toLowerCase()) || '';
      }, 120);
    });

    row.querySelector('.mad-remove').addEventListener('click', () => {
      row.remove();
      if (!rowsBox.querySelector('.mad-row')) addRow();
      rowsBox.querySelector('.mad-player-input')?.focus();
    });
    row.querySelector('.mad-add').addEventListener('click', () => {
      const nr = addRow('', row);
      nr.querySelector('.mad-player-input').focus();
    });

    if (after && after.nextSibling) {
      rowsBox.insertBefore(row, after.nextSibling);
    } else {
      rowsBox.appendChild(row);
    }
    return row;
  }

  addRow();

  function close() {
    window.removeEventListener('hashchange', close);
    overlay.remove();
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  window.addEventListener('hashchange', close, { once: true });
  card.querySelector('#mad-cancel').addEventListener('click', close);

  card.querySelector('#mad-save').addEventListener('click', () => {
    const date = card.querySelector('#mad-date').value;
    const seen = new Set();
    const players = [...card.querySelectorAll('.mad-player-input')]
      .map(i => memberByLower.get(i.value.trim().toLowerCase()))
      .filter(Boolean)
      .filter(n => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    try {
      const next = upsertManualEntry(Store.getManualAttendance(), { date, players }, tournamentDates());
      Store.setManualAttendance(next);
      showToast('Attendance saved');
      close();
    } catch (e) {
      showToast(e.message || 'Could not save');
    }
  });

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
