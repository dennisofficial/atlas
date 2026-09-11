const warm = {
  50: "#faf7f4",
  100: "#f0e9e3",
  200: "#ded3cb",
  300: "#c8b5ad",
  400: "#a69a92",
  500: "#8a8078",
  600: "#6b625c",
  700: "#524a45",
  800: "#3a3532",
  850: "#2b2724",
  900: "#282422",
  925: "#241f1c",
  950: "#1e1a17",
} as const;

const clay = {
  50: "#fdf3ef",
  100: "#fbe4da",
  200: "#f6c9b6",
  300: "#efa88b",
  400: "#e68e6c",
  500: "#d97757",
  600: "#c4603f",
  700: "#a44d31",
  800: "#813c27",
  900: "#5c2b1d",
  950: "#3d2318",
} as const;

const blue = {
  50: "#eff7ff",
  100: "#dbecff",
  200: "#bcdcff",
  300: "#7cbdff",
  400: "#5aa4f5",
  500: "#3d87e0",
  600: "#2f6cc0",
  700: "#28558f",
  800: "#1f3f6b",
  900: "#182c48",
  950: "#101c2c",
} as const;

const steel = {
  200: "#c3d0ee",
  300: "#9db3e8",
  400: "#7d9be0",
  500: "#5f7ec9",
  600: "#4a659f",
  700: "#3a4f7d",
  800: "#2c3a5b",
} as const;

const red = {
  50: "#fdf1f0",
  100: "#fadedc",
  200: "#f5bdb9",
  300: "#ee948e",
  400: "#e5534b",
  500: "#d13a32",
  600: "#b32d26",
  700: "#8f241f",
  800: "#6b1c18",
  900: "#4a1512",
  950: "#2e100e",
} as const;

const amber = {
  50: "#fdf6e7",
  100: "#f9e9bf",
  200: "#f2d488",
  300: "#e3b341",
  400: "#cf9a28",
  500: "#b07f1c",
  600: "#8f6615",
  700: "#6f4e0f",
  800: "#4f370a",
  900: "#352506",
  950: "#241a04",
} as const;

const green = {
  50: "#eef8ee",
  100: "#d4edd5",
  200: "#a8dcaa",
  300: "#7ee787",
  400: "#57ab5a",
  500: "#3f8f43",
  600: "#2f7333",
  700: "#255c28",
  800: "#1c451f",
  900: "#152f17",
  950: "#0e1f10",
} as const;

const violet = {
  200: "#ddcdfa",
  300: "#c7aef5",
  400: "#b392f0",
  500: "#9a6fe0",
  600: "#7f52c4",
  700: "#65419e",
  800: "#4c3178",
} as const;

const wash = {
  hover: warm[850],
  selected: "#3a332e",
  user: "#332e2a",
  userBand: warm[850],
} as const;

const accentChoices = {
  clay: clay[500],
  slate: "#7f9cc0",
  moss: "#7aa262",
  plum: "#b08cd0",
} as const;

const diff = {
  addDark: "#252d20",
  removeDark: "#322020",
  wordDark: "#335030",
  bandDark: "#241f1c",
  addLight: "#eef7ee",
  removeLight: "#fdf1f0",
  wordLight: "#cdecc6",
  bandLight: "#f0ebe4",
} as const;

export const primitives = {
  color: {
    warm,
    clay,
    blue,
    steel,
    red,
    amber,
    green,
    violet,
    wash,
    accentChoices,
    diff,
  },
} as const;

export type Primitives = typeof primitives;
