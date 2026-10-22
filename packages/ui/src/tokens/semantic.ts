import { primitives } from './primitives'

const { warm, clay, blue, red, amber, green, violet, wash, diff } = primitives.color

export enum EColorScheme {
  Dark = 'dark',
  Light = 'light',
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
  border: warm[800],
  input: warm[800],
  ring: clay[500],

  chart1: clay[500],
  chart2: blue[400],
  chart3: green[400],
  chart4: amber[300],
  chart5: violet[400],

  sidebar: warm[950],
  sidebarForeground: warm[100],
  sidebarPrimary: clay[500],
  sidebarPrimaryForeground: warm[925],
  sidebarAccent: wash.selected,
  sidebarAccentForeground: warm[100],
  sidebarBorder: warm[800],
  sidebarRing: clay[500],

  success: green[400],
  successForeground: warm[925],
  warning: amber[300],
  warningForeground: warm[925],

  code: blue[300],
  link: blue[300],

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
} as const

export type SemanticTheme = { [K in keyof typeof dark]: string }
export type SemanticToken = keyof SemanticTheme

const light: SemanticTheme = {
  background: '#f5f1ec',
  foreground: '#2a2522',
  card: '#fbf9f6',
  cardForeground: '#2a2522',
  popover: '#fdfcfa',
  popoverForeground: '#2a2522',
  primary: clay[700],
  primaryForeground: '#fdfcfa',
  secondary: '#ece6df',
  secondaryForeground: '#2a2522',
  muted: '#eae3db',
  mutedForeground: warm[600],
  accent: '#e4dcd2',
  accentForeground: '#2a2522',
  destructive: red[700],
  border: '#ddd4ca',
  input: '#ddd4ca',
  ring: clay[700],

  chart1: clay[700],
  chart2: blue[600],
  chart3: green[600],
  chart4: amber[600],
  chart5: violet[600],

  sidebar: '#fbf9f6',
  sidebarForeground: '#2a2522',
  sidebarPrimary: clay[700],
  sidebarPrimaryForeground: '#fdfcfa',
  sidebarAccent: '#e4dcd2',
  sidebarAccentForeground: '#2a2522',
  sidebarBorder: '#ddd4ca',
  sidebarRing: clay[700],

  success: green[600],
  successForeground: '#fdfcfa',
  warning: amber[600],
  warningForeground: '#fdfcfa',

  code: blue[700],
  link: blue[700],

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

  scrollbarThumb: '#ddd4ca',
  scrollbarThumbHover: warm[400],
}

export const semantic: Record<EColorScheme, SemanticTheme> = {
  [EColorScheme.Dark]: dark,
  [EColorScheme.Light]: light,
}
