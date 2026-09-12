import { primitives } from "./primitives";

const { warm, clay, blue, steel, red, amber, green, violet, wash, diff } =
  primitives.color;

export enum EColorScheme {
  Dark = "dark",
  Light = "light",
}

const dark = {
  background: warm[900],
  foreground: warm[100],
  card: warm[950],
  cardForeground: warm[100],
  popover: warm[925],
  popoverForeground: warm[100],
  primary: clay[500],
  primaryForeground: warm[925],
  secondary: wash.user,
  secondaryForeground: warm[100],
  muted: warm[850],
  mutedForeground: warm[500],
  accent: wash.selected,
  accentForeground: warm[100],
  destructive: red[400],
  destructiveForeground: warm[925],
  success: green[400],
  successForeground: warm[925],
  warning: amber[300],
  warningForeground: warm[925],
  border: warm[800],
  input: warm[800],
  ring: clay[500],

  surfaceOverlay: warm[925],
  surfacePanel: warm[950],
  hover: wash.hover,
  selected: wash.selected,
  rule: warm[800],
  meta: warm[500],
  hint: warm[600],
  code: blue[300],
  link: blue[300],
  codeInline: clay[500],
  steel: steel[400],
  external: violet[400],

  bubbleUser: wash.user,
  bubbleUserForeground: warm[100],
  bubbleUserBand: wash.userBand,
  bandAgent: clay[950],
  bandAgentForeground: "#f3e3d8",

  caret: clay[500],
  caretForeground: warm[925],

  diffAdd: diff.addDark,
  diffAddForeground: green[400],
  diffRemove: diff.removeDark,
  diffRemoveForeground: red[400],
  diffWord: diff.wordDark,
  diffBand: diff.bandDark,
  diffGutter: warm[500],

  syntaxKeyword: clay[500],
  syntaxString: green[400],
  syntaxComment: warm[600],
  syntaxFunction: blue[300],
  syntaxType: blue[300],
  syntaxConstant: amber[300],
  syntaxPunctuation: warm[600],

  scrollbarThumb: warm[800],
  scrollbarThumbHover: warm[700],
  scrim: "rgb(0 0 0 / 0.27)",

  shadowCard: "0 1px 2px rgb(0 0 0 / 0.3), 0 14px 44px rgb(0 0 0 / 0.5)",
  shadowMenu: "0 18px 50px rgb(0 0 0 / 0.55)",
  shadowPalette: "0 30px 80px rgb(0 0 0 / 0.7)",
  shadowInsetRail: "inset 2px 0 0 #d97757",
  glowPrimary: "0 4px 14px rgb(217 119 87 / 0.18)",
} as const;

export type SemanticTheme = { [K in keyof typeof dark]: string };
export type SemanticToken = keyof SemanticTheme;

const light: SemanticTheme = {
  background: "#f5f1ec",
  foreground: "#2a2522",
  card: "#fbf9f6",
  cardForeground: "#2a2522",
  popover: "#fdfcfa",
  popoverForeground: "#2a2522",
  primary: clay[700],
  primaryForeground: "#fdfcfa",
  secondary: "#ece6df",
  secondaryForeground: "#2a2522",
  muted: "#eae3db",
  mutedForeground: warm[600],
  accent: "#e4dcd2",
  accentForeground: "#2a2522",
  destructive: red[700],
  destructiveForeground: "#fdfcfa",
  success: green[600],
  successForeground: "#fdfcfa",
  warning: amber[600],
  warningForeground: "#fdfcfa",
  border: "#ddd4ca",
  input: "#ddd4ca",
  ring: clay[700],

  surfaceOverlay: "#fdfcfa",
  surfacePanel: "#fbf9f6",
  hover: "#ece6df",
  selected: "#e4dcd2",
  rule: "#ddd4ca",
  meta: warm[600],
  hint: warm[500],
  code: blue[700],
  link: blue[700],
  codeInline: clay[700],
  steel: steel[600],
  external: violet[700],

  bubbleUser: "#ece6df",
  bubbleUserForeground: "#2a2522",
  bubbleUserBand: "#e4dcd2",
  bandAgent: clay[100],
  bandAgentForeground: clay[900],

  caret: clay[700],
  caretForeground: "#fdfcfa",

  diffAdd: diff.addLight,
  diffAddForeground: green[700],
  diffRemove: diff.removeLight,
  diffRemoveForeground: red[700],
  diffWord: diff.wordLight,
  diffBand: diff.bandLight,
  diffGutter: warm[600],

  syntaxKeyword: clay[700],
  syntaxString: green[700],
  syntaxComment: warm[500],
  syntaxFunction: blue[700],
  syntaxType: blue[700],
  syntaxConstant: amber[700],
  syntaxPunctuation: warm[500],

  scrollbarThumb: "#ddd4ca",
  scrollbarThumbHover: warm[400],
  scrim: "rgb(42 37 34 / 0.22)",

  shadowCard: "0 1px 2px rgb(0 0 0 / 0.04), 0 14px 44px rgb(0 0 0 / 0.06)",
  shadowMenu: "0 18px 50px rgb(0 0 0 / 0.22)",
  shadowPalette: "0 30px 80px rgb(0 0 0 / 0.4)",
  shadowInsetRail: "inset 2px 0 0 #a44d31",
  glowPrimary: "0 4px 14px rgb(164 77 49 / 0.14)",
};

export const semantic: Record<EColorScheme, SemanticTheme> = {
  [EColorScheme.Dark]: dark,
  [EColorScheme.Light]: light,
};
