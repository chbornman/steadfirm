import { describe, expect, test } from 'bun:test';
import { colors, spacing, radii, typography } from './tokens';

describe('colors', () => {
  test('accent is the brand purple', () => {
    expect(colors.accent).toBe('#7C3AED');
  });

  test('includes all service colors', () => {
    expect(colors.photos).toBe('#3B82F6');
    expect(colors.media).toBe('#8B5CF6');
    expect(colors.documents).toBe('#22C55E');
    expect(colors.audiobooks).toBe('#D97706');
    expect(colors.files).toBe('#737373');
  });
});

describe('spacing', () => {
  test('scale is ascending', () => {
    expect(spacing.xs).toBeLessThan(spacing.sm);
    expect(spacing.sm).toBeLessThan(spacing.md);
    expect(spacing.md).toBeLessThan(spacing.lg);
    expect(spacing.lg).toBeLessThan(spacing.xl);
    expect(spacing.xl).toBeLessThan(spacing.xxl);
  });
});

describe('radii', () => {
  test('full is 9999 (pill shape)', () => {
    expect(radii.full).toBe(9999);
  });
});

describe('typography', () => {
  test('fontFamilyScript is Kaushan Script', () => {
    expect(typography.fontFamilyScript).toContain('Kaushan Script');
  });
});
