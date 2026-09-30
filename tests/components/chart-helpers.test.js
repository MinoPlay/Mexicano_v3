import { describe, it, expect } from 'vitest';
import { niceTicks, linearScale, heatColor, sparklineSvg } from '../../js/components/chart.js';

describe('chart niceTicks', () => {
  it('0..100 in 5 steps', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it('987..1043 uses step 10 covering range', () => {
    expect(niceTicks(987, 1043, 5)).toEqual([980, 990, 1000, 1010, 1020, 1030, 1040, 1050]);
  });

  it('degenerate range still returns ticks around value', () => {
    const t = niceTicks(1000, 1000, 5);
    expect(t.length).toBeGreaterThan(1);
    expect(t[0]).toBeLessThanOrEqual(1000);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(1000);
  });
});

describe('chart linearScale', () => {
  it('maps domain to range', () => {
    const s = linearScale([0, 10], [100, 200]);
    expect(s(0)).toBe(100);
    expect(s(5)).toBe(150);
    expect(s(10)).toBe(200);
  });

  it('degenerate domain maps to range midpoint', () => {
    expect(linearScale([5, 5], [0, 100])(5)).toBe(50);
  });
});

describe('chart heatColor', () => {
  it('mid and null are transparent', () => {
    expect(heatColor(50)).toBe('transparent');
    expect(heatColor(null)).toBe('transparent');
  });

  it('high is green, low is red', () => {
    expect(heatColor(100)).toMatch(/^rgba\(74, 222, 128, /);
    expect(heatColor(0)).toMatch(/^rgba\(248, 113, 113, /);
  });
});

describe('chart sparklineSvg', () => {
  it('empty for <2 points', () => {
    expect(sparklineSvg([1])).toBe('');
  });

  it('svg polyline for series', () => {
    const svg = sparklineSvg([1, 2, 3], { width: 60, height: 20 });
    expect(svg).toContain('<svg');
    expect(svg).toContain('polyline');
  });
});
