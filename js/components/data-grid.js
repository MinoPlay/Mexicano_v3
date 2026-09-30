/**
 * Desktop data grid: dense sortable/filterable table with sticky header,
 * row selection and optional multi-select checkboxes.
 */

function isMissing(v) {
  return v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v));
}

export function sortRows(rows, key, dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i }))
    .sort((x, y) => {
      const a = x.row[key];
      const b = y.row[key];
      const am = isMissing(a);
      const bm = isMissing(b);
      if (am || bm) return am === bm ? x.i - y.i : (am ? 1 : -1);
      let cmp;
      if (typeof a === 'string' || typeof b === 'string') cmp = String(a).localeCompare(String(b));
      else cmp = a - b;
      return cmp !== 0 ? cmp * sign : x.i - y.i;
    })
    .map(x => x.row);
}

export function filterRows(rows, query, keys) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(row => keys.some(k => String(row[k] ?? '').toLowerCase().includes(q)));
}

export function nextSortState(current, clickedKey, defaultDir = 'desc') {
  if (current && current.key === clickedKey) {
    return { key: clickedKey, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: clickedKey, dir: defaultDir };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {Object} opts
 * @param {Array} opts.columns - [{key,label,type,format,html,align,width,title,defaultDir}]
 * @param {Array} opts.rows
 * @param {{key,dir}} [opts.sort]
 * @param {string[]} [opts.searchKeys] - enables search box when provided
 * @param {Function} [opts.onRowClick] - (row) => void
 * @param {string} [opts.rowKey='name']
 * @param {*} [opts.selectedKey]
 * @param {boolean} [opts.multiSelect]
 * @param {Function} [opts.onSelectionChange] - (Set<key>) => void
 * @param {string} [opts.toolbarHtml] - extra html rendered right of search
 * @param {string} [opts.emptyText]
 */
export function createDataGrid(opts) {
  const {
    columns,
    searchKeys = null,
    onRowClick = null,
    rowKey = 'name',
    multiSelect = false,
    onSelectionChange = null,
    toolbarHtml = '',
    emptyText = 'No data',
    maxHeight = null,
  } = opts;

  let rows = opts.rows || [];
  let sort = opts.sort || { key: columns[0].key, dir: 'desc' };
  let query = '';
  let selectedKey = opts.selectedKey ?? null;
  const checked = new Set(opts.checked || []);

  const el = document.createElement('div');
  el.className = 'data-grid';

  if (searchKeys || toolbarHtml) {
    const toolbar = document.createElement('div');
    toolbar.className = 'data-grid-toolbar';
    toolbar.innerHTML = `
      ${searchKeys ? '<input type="search" class="data-grid-search" placeholder="Search…" aria-label="Search">' : ''}
      <div class="data-grid-toolbar-extra">${toolbarHtml}</div>
      <span class="data-grid-count text-xs text-secondary"></span>`;
    el.appendChild(toolbar);
    const search = toolbar.querySelector('.data-grid-search');
    search?.addEventListener('input', () => { query = search.value; renderBody(); });
  }

  const scroller = document.createElement('div');
  scroller.className = 'data-grid-scroll';
  if (maxHeight) scroller.style.maxHeight = maxHeight;
  const table = document.createElement('table');
  scroller.appendChild(table);
  el.appendChild(scroller);

  function renderHead() {
    const ths = columns.map(col => {
      const cls = ['sortable'];
      if (col.align) cls.push(`align-${col.align}`);
      if (sort.key === col.key) cls.push(sort.dir === 'asc' ? 'sort-asc' : 'sort-desc');
      const style = col.width ? ` style="width:${col.width}"` : '';
      const title = col.title ? ` title="${escapeHtml(col.title)}"` : '';
      return `<th class="${cls.join(' ')}" data-key="${col.key}"${style}${title}>${escapeHtml(col.label)}</th>`;
    }).join('');
    const checkTh = multiSelect ? '<th class="check-col"></th>' : '';
    return `<thead><tr>${checkTh}${ths}</tr></thead>`;
  }

  function cellHtml(col, row) {
    const v = row[col.key];
    if (col.html) return col.html(v, row);
    if (col.format) return escapeHtml(col.format(v, row));
    return isMissing(v) ? '—' : escapeHtml(v);
  }

  function visibleRows() {
    return sortRows(searchKeys ? filterRows(rows, query, searchKeys) : rows, sort.key, sort.dir);
  }

  function renderBody() {
    const list = visibleRows();
    const body = list.length === 0
      ? `<tbody><tr><td class="data-grid-empty" colspan="${columns.length + (multiSelect ? 1 : 0)}">${escapeHtml(emptyText)}</td></tr></tbody>`
      : `<tbody>${list.map((row, i) => {
        const key = row[rowKey];
        const cls = [];
        if (onRowClick) cls.push('clickable');
        if (selectedKey !== null && key === selectedKey) cls.push('selected');
        const check = multiSelect
          ? `<td class="check-col"><input type="checkbox" data-check="${i}" ${checked.has(key) ? 'checked' : ''} aria-label="Select ${escapeHtml(key)}"></td>`
          : '';
        const tds = columns.map(col => `<td class="${col.align ? `align-${col.align}` : ''}">${cellHtml(col, row)}</td>`).join('');
        return `<tr data-idx="${i}" class="${cls.join(' ')}">${check}${tds}</tr>`;
      }).join('')}</tbody>`;
    table.innerHTML = renderHead() + body;

    const count = el.querySelector('.data-grid-count');
    if (count) count.textContent = `${list.length} / ${rows.length}`;

    table.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = columns.find(c => c.key === th.dataset.key);
        const defaultDir = col.defaultDir || (col.type === 'str' ? 'asc' : 'desc');
        sort = nextSortState(sort, col.key, defaultDir);
        renderBody();
      });
    });

    table.querySelectorAll('tbody tr[data-idx]').forEach(tr => {
      const row = list[Number(tr.dataset.idx)];
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.check-col')) return;
        if (!onRowClick) return;
        selectedKey = row[rowKey];
        table.querySelectorAll('tbody tr.selected').forEach(x => x.classList.remove('selected'));
        tr.classList.add('selected');
        onRowClick(row);
      });
    });

    table.querySelectorAll('input[data-check]').forEach(cb => {
      cb.addEventListener('change', () => {
        const key = list[Number(cb.dataset.check)][rowKey];
        if (cb.checked) checked.add(key); else checked.delete(key);
        onSelectionChange?.(new Set(checked));
      });
    });
  }

  renderBody();

  return {
    el,
    setRows(next) { rows = next || []; renderBody(); },
    setSelected(key) { selectedKey = key; renderBody(); },
    getChecked() { return new Set(checked); },
    clearChecked() { checked.clear(); renderBody(); onSelectionChange?.(new Set()); },
  };
}
