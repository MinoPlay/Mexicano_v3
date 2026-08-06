import { describe, it, expect } from 'vitest';
import {
  ELO_ENTRY_COLORS,
  colorForEntryIndex,
  buildEntryColorMap,
} from '../../js/pages/elo-charts.js';

describe('ELO entry-number color palette', () => {
  it('has a fixed table of 10 prefixed colors', () => {
    expect(Array.isArray(ELO_ENTRY_COLORS)).toBe(true);
    expect(ELO_ENTRY_COLORS.length).toBe(10);
  });

  it('all 10 palette colors are unique', () => {
    expect(new Set(ELO_ENTRY_COLORS).size).toBe(10);
  });

  it('first 5 colors are hue-wise very different (>=45deg apart)', () => {
    // First five entries are hard-coded hex; assert perceptual spread via hue.
    const hues = ELO_ENTRY_COLORS.slice(0, 5).map(hexToHue);
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        expect(hueDistance(hues[i], hues[j])).toBeGreaterThanOrEqual(45);
      }
    }
  });

  it('maps entry index to its palette color for the first 10', () => {
    for (let i = 0; i < 10; i++) {
      expect(colorForEntryIndex(i)).toBe(ELO_ENTRY_COLORS[i]);
    }
  });

  it('falls back to a generated color past 10 entries', () => {
    const c10 = colorForEntryIndex(10);
    expect(typeof c10).toBe('string');
    expect(ELO_ENTRY_COLORS).not.toContain(c10);
  });

  it('assigns colors by selection (entry) order, not name', () => {
    expect(buildEntryColorMap(['Zed', 'Alice', 'Bob'])).toEqual({
      Zed: ELO_ENTRY_COLORS[0],
      Alice: ELO_ENTRY_COLORS[1],
      Bob: ELO_ENTRY_COLORS[2],
    });
  });

  it('ignores duplicates keeping first-seen entry number', () => {
    const map = buildEntryColorMap(['Alice', 'Bob', 'Alice']);
    expect(map.Alice).toBe(ELO_ENTRY_COLORS[0]);
    expect(map.Bob).toBe(ELO_ENTRY_COLORS[1]);
  });
});

function hexToHue(hex) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = Math.round(h * 60);
  return (h + 360) % 360;
}

function hueDistance(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
