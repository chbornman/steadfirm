export const duration = {
  instant: 0.15,
  fast: 0.25,
  normal: 0.4,
  slow: 0.6,
  entrance: 0.7,
};

export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
  inOut: [0.45, 0, 0.55, 1] as const,
  spring: { type: 'spring' as const, stiffness: 260, damping: 28 },
  gentleSpring: { type: 'spring' as const, stiffness: 140, damping: 22 },
};

export const stagger = {
  fast: 0.05,
  normal: 0.07,
  slow: 0.1,
};

export const gridContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: stagger.fast },
  },
};

export const gridItem = {
  hidden: { opacity: 0, y: 8, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: ease.gentleSpring,
  },
};

export const fadeIn = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: duration.normal },
  },
};

export const slideUp = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: ease.spring,
  },
  exit: {
    opacity: 0,
    y: 20,
    transition: { duration: duration.normal },
  },
};
