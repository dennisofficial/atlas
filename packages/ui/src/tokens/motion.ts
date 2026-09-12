export const ease = {
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  standard: "ease",
} as const;

export const duration = {
  instant: "80ms",
  fast: "120ms",
  normal: "180ms",
  slow: "220ms",
  spinnerFrame: "80ms",
} as const;

export const keyframes = {
  "atlas-fade-up": {
    from: "transform: translateY(8px); opacity: 0;",
    to: "transform: translateY(0); opacity: 1;",
  },
  "atlas-pop": {
    from: "transform: scale(0.96);",
    to: "transform: scale(1);",
  },
  "atlas-soft-pulse": {
    "0%, 100%": "transform: scale(1); opacity: 1;",
    "50%": "transform: scale(1.35); opacity: 0.55;",
  },
  "atlas-caret-pulse": {
    "0%, 100%": "opacity: 1;",
    "50%": "opacity: 0.25;",
  },
  "atlas-blink": {
    "0%, 49%": "opacity: 1;",
    "50%, 100%": "opacity: 0;",
  },
  "atlas-sweep": {
    "0%": "transform: translateX(-100%);",
    "100%": "transform: translateX(100%);",
  },
  "atlas-spin": {
    to: "transform: rotate(360deg);",
  },
  "atlas-slide-in-right": {
    from: "transform: translateX(100%);",
    to: "transform: translateX(0);",
  },
  "atlas-slide-in-bottom": {
    from: "transform: translateY(100%);",
    to: "transform: translateY(0);",
  },
} as const;
