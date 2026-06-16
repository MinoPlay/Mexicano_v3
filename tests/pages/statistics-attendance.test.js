import { describe, it, expect } from 'vitest';
import { computeAttendance, getMonthsForAttendanceFilter } from '../../js/services/statistics.js';

const TODAY = new Date('2026-06-15');

// ---------------------------------------------------------------------------
// getMonthsForAttendanceFilter
// ---------------------------------------------------------------------------
describe('getMonthsForAttendanceFilter', () => {
  it('latest -> current month only', () => {
    expect(getMonthsForAttendanceFilter('latest', TODAY)).toEqual(['2026-06']);
  });

  it('30 -> two months', () => {
    expect(getMonthsForAttendanceFilter('30', TODAY)).toEqual(['2026-05', '2026-06']);
  });

  it('60 -> three months', () => {
    expect(getMonthsForAttendanceFilter('60', TODAY)).toEqual(['2026-04', '2026-05', '2026-06']);
  });

  it('90 -> four months', () => {
    expect(getMonthsForAttendanceFilter('90', TODAY)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06']);
  });

  it('120 -> five months', () => {
    expect(getMonthsForAttendanceFilter('120', TODAY)).toEqual(['2026-02', '2026-03', '2026-04', '2026-05', '2026-06']);
  });
});

// ---------------------------------------------------------------------------
// computeAttendance
// ---------------------------------------------------------------------------
describe('computeAttendance', () => {
  // PAIR 1 – filter="latest": count ELO entries in current month
  it('PAIR1 latest: counts array ELO entries in current month', () => {
    const raw = {
      '2026-06': [
        { Name: 'Jeremy', ELO: [{ Date: '2026-06-02', ELO: 1251.53 }, { Date: '2026-06-04', ELO: 1258.17 }, { Date: '2026-06-11', ELO: 1270.8 }] },
        { Name: 'Ana',    ELO: [{ Date: '2026-06-02', ELO: 1100 },    { Date: '2026-06-11', ELO: 1105 }] },
      ],
    };
    expect(computeAttendance(raw, 'latest', TODAY)).toEqual([
      { name: 'Jeremy', attendance: 3 },
      { name: 'Ana',    attendance: 2 },
    ]);
  });

  // PAIR 2 – filter="30" cutoff 2026-05-16: May-10 excluded
  it('PAIR2 30 days: excludes entries before cutoff, combines months', () => {
    const raw = {
      '2026-05': [
        { Name: 'Jeremy', ELO: [{ Date: '2026-05-10', ELO: 1240 }, { Date: '2026-05-20', ELO: 1245 }] },
        { Name: 'Bob',    ELO: [{ Date: '2026-05-20', ELO: 1050 }] },
      ],
      '2026-06': [
        { Name: 'Jeremy', ELO: [{ Date: '2026-06-02', ELO: 1251.53 }, { Date: '2026-06-04', ELO: 1258.17 }, { Date: '2026-06-11', ELO: 1270.8 }] },
        { Name: 'Ana',    ELO: [{ Date: '2026-06-02', ELO: 1100 },    { Date: '2026-06-11', ELO: 1105 }] },
      ],
    };
    expect(computeAttendance(raw, '30', TODAY)).toEqual([
      { name: 'Jeremy', attendance: 4 },
      { name: 'Ana',    attendance: 2 },
      { name: 'Bob',    attendance: 1 },
    ]);
  });

  // PAIR 3 – filter="60" cutoff 2026-04-16: Apr-10 excluded
  it('PAIR3 60 days: excludes Apr entries before cutoff', () => {
    const raw = {
      '2026-04': [
        { Name: 'Ana', ELO: [{ Date: '2026-04-10', ELO: 1090 }, { Date: '2026-04-20', ELO: 1095 }] },
      ],
      '2026-05': [
        { Name: 'Jeremy', ELO: [{ Date: '2026-05-10', ELO: 1240 }, { Date: '2026-05-20', ELO: 1245 }] },
        { Name: 'Bob',    ELO: [{ Date: '2026-05-20', ELO: 1050 }] },
      ],
      '2026-06': [
        { Name: 'Jeremy', ELO: [{ Date: '2026-06-02', ELO: 1251.53 }, { Date: '2026-06-04', ELO: 1258.17 }, { Date: '2026-06-11', ELO: 1270.8 }] },
        { Name: 'Ana',    ELO: [{ Date: '2026-06-02', ELO: 1100 },    { Date: '2026-06-11', ELO: 1105 }] },
      ],
    };
    expect(computeAttendance(raw, '60', TODAY)).toEqual([
      { name: 'Jeremy', attendance: 5 },
      { name: 'Ana',    attendance: 3 },
      { name: 'Bob',    attendance: 1 },
    ]);
  });

  // PAIR 4 – tie -> name asc
  it('PAIR4 tie in attendance: sorted by name asc', () => {
    const raw = {
      '2026-06': [
        { Name: 'Zara', ELO: [{ Date: '2026-06-02', ELO: 1200 }, { Date: '2026-06-11', ELO: 1205 }] },
        { Name: 'Adam', ELO: [{ Date: '2026-06-02', ELO: 1150 }, { Date: '2026-06-11', ELO: 1155 }] },
      ],
    };
    expect(computeAttendance(raw, 'latest', TODAY)).toEqual([
      { name: 'Adam', attendance: 2 },
      { name: 'Zara', attendance: 2 },
    ]);
  });

  // PAIR 5 – player with empty ELO array excluded
  it('PAIR5 empty ELO array: player excluded from result', () => {
    const raw = {
      '2026-06': [
        { Name: 'Jeremy', ELO: [{ Date: '2026-06-02', ELO: 1251.53 }] },
        { Name: 'Ana',    ELO: [] },
      ],
    };
    expect(computeAttendance(raw, 'latest', TODAY)).toEqual([
      { name: 'Jeremy', attendance: 1 },
    ]);
  });

  // PAIR 6 – legacy numeric ELO excluded
  it('PAIR6 legacy numeric ELO: player excluded from result', () => {
    const raw = {
      '2026-06': [
        { Name: 'Jeremy', ELO: [{ Date: '2026-06-02', ELO: 1251.53 }] },
        { Name: 'Legacy', ELO: 1200 },
      ],
    };
    expect(computeAttendance(raw, 'latest', TODAY)).toEqual([
      { name: 'Jeremy', attendance: 1 },
    ]);
  });
});
