import type { ThemeConfig } from 'antd';
import { theme } from 'antd';
import { colors, radii, typography } from './tokens';

export const lightTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    fontFamily: typography.fontFamily,
    colorPrimary: colors.accent,
    colorLink: colors.accent,
    borderRadius: radii.md,
    colorBgContainer: colors.neutral50,
    colorBgLayout: colors.neutral100,
    colorText: colors.neutral900,
    colorTextSecondary: colors.neutral500,
    colorBorder: colors.neutral200,
  },
  components: {
    Layout: {
      headerBg: 'rgba(250, 250, 250, 0.8)',
      bodyBg: colors.neutral100,
    },
    Menu: {
      itemBg: 'transparent',
      horizontalItemSelectedColor: colors.accent,
      horizontalItemSelectedBg: 'transparent',
    },
    Slider: {
      trackBg: colors.accent,
      trackHoverBg: colors.accentLight,
      handleColor: colors.accent,
      handleActiveColor: colors.accentLight,
    },
    Segmented: {
      itemSelectedBg: colors.accent,
      itemSelectedColor: colors.neutral0,
    },
  },
};

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    fontFamily: typography.fontFamily,
    colorPrimary: colors.accentLight,
    colorLink: colors.accentLight,
    borderRadius: radii.md,
    colorBgContainer: colors.neutral900,
    colorBgLayout: colors.neutral950,
    colorText: colors.neutral100,
    colorTextSecondary: colors.neutral400,
    colorBorder: colors.neutral700,
  },
  components: {
    Layout: {
      headerBg: 'rgba(10, 10, 10, 0.8)',
      bodyBg: colors.neutral950,
    },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: 'transparent',
      darkItemSelectedColor: colors.accentLight,
    },
    Slider: {
      trackBg: colors.accentLight,
      trackHoverBg: colors.accent,
      handleColor: colors.accentLight,
      handleActiveColor: colors.accent,
    },
    Segmented: {
      itemSelectedBg: colors.accentLight,
      itemSelectedColor: colors.neutral950,
    },
  },
};
