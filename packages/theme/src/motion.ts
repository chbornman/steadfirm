export const duration = {
  instant: 0.1,
  fast: 0.15,
  normal: 0.25,
  slow: 0.4,
  entrance: 0.5,
};

export const ease = {
  out: [0.16, 1, 0.3, 1] as const,
  inOut: [0.45, 0, 0.55, 1] as const,
  spring: { type: 'spring' as const, stiffness: 400, damping: 30 },
  gentleSpring: { type: 'spring' as const, stiffness: 200, damping: 25 },
};

export const stagger = {
  fast: 0.03,
  normal: 0.05,
  slow: 0.08,
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
