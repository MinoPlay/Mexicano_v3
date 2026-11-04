import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

describe('desktop responsive layout', () => {
  it('uses the real viewport and never forces page-level horizontal scrolling', () => {
    const html = read('index.html');
    const css = read('css/desktop.css');

    expect(html).toContain('content="width=device-width, initial-scale=1"');
    expect(css).not.toMatch(/body\s*\{\s*min-width:\s*1024px/);
    expect(css).toMatch(/html\s*\{\s*font-size:\s*clamp\([^}]*16px\)/);
    expect(css).toMatch(/\.split-view\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*max-content\)\s+minmax\(18rem,\s*1fr\)/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*1400px\)[^{]*\{[\s\S]*?\.split-view[^{]*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  it('keeps controls flexible and dense tables scrolling inside their panels', () => {
    const css = read('css/desktop.css');

    expect(css).toMatch(/\.panel-actions\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\.data-grid-toolbar\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\.data-grid-scroll\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.data-grid table\s*\{[^}]*width:\s*max-content[^}]*min-width:\s*100%/s);
    expect(css).toMatch(/\.data-table\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.data-table table\s*\{[^}]*width:\s*max-content[^}]*min-width:\s*100%/s);
  });

  it('sizes the tournament match list from the Matches panel with one intrinsic grid', () => {
    const css = read('css/desktop.css');
    const list = css.match(/\.tournament-desktop \.round-list\s*\{([^}]*)\}/)?.[1] ?? '';
    const columns = list.match(/grid-template-columns:\s*([^;]*);/)?.[1] ?? '';

    expect(list).toMatch(/display:\s*grid/);
    // label | court | team 1 | score | team 2 — content-sized, team columns share what is left
    expect(columns.trim().split(/\s+(?![^(]*\))/)).toEqual([
      'max-content', 'max-content', 'minmax(0, auto)', 'max-content', 'minmax(0, auto)',
    ]);
    expect(css).toMatch(/\.tournament-desktop \.round-list > \*\s*\{[^}]*grid-column:\s*1 \/ -1/);
  });

  it('lines rounds, court lists and match cards up on the list columns (subgrid, no fixed widths)', () => {
    const css = read('css/desktop.css');
    const rule = (sel) => css.match(new RegExp(`${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
    const section = rule('.tournament-desktop .round-section');
    const matches = rule('.tournament-desktop .round-matches');
    const card = rule('.tournament-desktop .round-matches .match-card');

    for (const r of [section, matches, card]) {
      expect(r).toMatch(/display:\s*grid/);
      expect(r).toMatch(/grid-template-columns:\s*subgrid/);
      expect(r).not.toMatch(/width:|flex:/);
    }
    expect(rule('.tournament-desktop .round-label')).toMatch(/grid-column:\s*1\b/);
    expect(matches).toMatch(/grid-column:\s*2 \/ -1/);
    expect(card).toMatch(/grid-column:\s*1 \/ -1/);
    expect(css).not.toMatch(/\.tournament-desktop \.round-header/);
    expect(css).not.toMatch(/42rem/);
  });

  it('gives the Players table priority and keeps selected-player cards compact', () => {
    const css = read('css/desktop.css');

    expect(css).toMatch(/\.split-detail \.kpi-row\s*\{[^}]*minmax\(6\.5rem,\s*1fr\)/s);
    expect(css).toMatch(/\.split-detail \.kpi\s*\{[^}]*padding:\s*var\(--space-xs\)\s+var\(--space-sm\)/s);
    expect(css).toMatch(/\.data-grid th\s*\{[^}]*padding:\s*0\.45em\s+0\.55em/s);
    expect(css).toMatch(/\.data-grid td\s*\{[^}]*padding:\s*0\.4em\s+0\.55em/s);
  });
});
