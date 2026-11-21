import { describe, expect, it } from 'vitest';
import { fromSI, toSI, formatStation, formatQuantity, LBF, FT } from '../src';

describe('units', () => {
  it('round-trips every dimension in every system', () => {
    const systems = ['US', 'SI_N', 'SI_daN'] as const;
    const dims = ['length', 'smallLength', 'area', 'force', 'forcePerLength', 'pressure', 'stress',
      'temperature', 'velocity', 'density', 'angle', 'expansion', 'ratio'] as const;
    for (const s of systems) for (const d of dims) {
      expect(fromSI(toSI(123.456, s, d), s, d)).toBeCloseTo(123.456, 9);
    }
  });

  it('uses the international foot and pound-force', () => {
    expect(toSI(1, 'US', 'length')).toBe(0.3048);
    expect(toSI(1, 'US', 'force')).toBeCloseTo(4.4482216152605, 12);
    expect(toSI(1, 'US', 'forcePerLength')).toBeCloseTo(LBF / FT, 10);
  });

  it('converts temperature with offset', () => {
    expect(toSI(32, 'US', 'temperature')).toBeCloseTo(0, 12);
    expect(toSI(212, 'US', 'temperature')).toBeCloseTo(100, 12);
    expect(fromSI(15, 'US', 'temperature')).toBeCloseTo(59, 12);
  });

  it('daN and km/h conversions', () => {
    expect(toSI(1, 'SI_daN', 'force')).toBe(10);
    expect(toSI(36, 'SI_daN', 'velocity')).toBeCloseTo(10, 12);
  });

  it('wind pressure Q factors relate consistently (manual Eq. 7-1)', () => {
    // 0.6125 Pa per (m/s)^2 vs 0.00256 psf per mph^2. The two rounded constants
    // quoted by the manual differ by about 0.14 %, so Q is an input stored per
    // weather case and is never converted from one system's constant to the other.
    const W = 40; // m/s
    const pSI = 0.6125 * W * W;
    const Wmph = W / 0.44704;
    const pUS = toSI(0.00256 * Wmph * Wmph, 'US', 'pressure');
    const diff = Math.abs(pUS - pSI) / pSI;
    expect(diff).toBeGreaterThan(1e-3);
    expect(diff).toBeLessThan(2e-3);
  });

  it('formats stations', () => {
    expect(formatStation(1234.5, 'SI_N')).toBe('1+234.50');
    expect(formatStation(toSI(12345.6, 'US', 'length'), 'US')).toBe('123+45.60');
    expect(formatQuantity(1000, 'SI_daN', 'force')).toBe('100 daN');
    // Values that are a whole station after unit conversion must not print as "44+100.00".
    expect(formatStation(4500 * 0.3048, 'US')).toBe('45+00.00');
    expect(formatStation(1999.999, 'SI_N')).toBe('2+000.00');
    expect(formatStation(99.996 * 0.3048, 'US')).toBe('1+00.00');
    expect(formatStation(-150.5, 'SI_N')).toBe('-0+150.50');
  });
});
