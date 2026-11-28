import { primitives } from './primitives'

const { graphite, steel, blue, red, amber, green, violet, wash, diff } = primitives.color

export enum EColorScheme {
  Dark = 'dark',
  Light = 'light',
}

const READING_TEXT = '#dcdcdc'

const dark = {
  background: graphite[900],
  foreground: READING_TEXT,
  card: graphite[950],
  cardForeground: READING_TEXT,
  popover: graphite[925],
  popoverForeground: READING_TEXT,
  primary: graphite[100],
  primaryForeground: graphite[925],
  secondary: wash.user,
  secondaryForeground: READING_TEXT,
  muted: graphite[850],
  skeleton: '#303030',
  mutedForeground: graphite[500],
  accent: wash.selected,
  accentForeground: READING_TEXT,
  destructive: red[400],
  border: graphite[800],
  input: graphite[800],
  ring: graphite[500],

  chart1: steel[400],
  chart2: blue[400],
  chart3: green[400],
  chart4: amber[300],
  chart5: violet[400],

  sidebar: graphite[950],
  sidebarForeground: READING_TEXT,
  sidebarPrimary: graphite[100],
  sidebarPrimaryForeground: graphite[925],
  sidebarAccent: wash.selected,
  sidebarAccentForeground: READING_TEXT,
  sidebarBorder: graphite[800],
  sidebarRing: graphite[500],

  success: green[400],
  successForeground: graphite[925],
  prOpen: '#3fb950',
  prDraft: '#9198a1',
  prMerged: '#ab7df8',
  prClosed: '#f85149',
  prQueued: '#d29922',
  warning: amber[300],
  warningForeground: graphite[925],

  code: graphite[300],
  codeBackground: '#303030',
  link: blue[300],

  diffAdd: diff.addDark,
  diffAddForeground: green[400],
  diffRemove: diff.removeDark,
  diffRemoveForeground: red[400],
  diffWord: diff.wordDark,
  diffBand: diff.bandDark,
  diffGutter: graphite[500],

  syntaxKeyword: violet[300],
  syntaxString: green[400],
  syntaxComment: graphite[600],
  syntaxFunction: blue[300],
  syntaxType: blue[300],
  syntaxConstant: amber[300],
  syntaxPunctuation: graphite[600],

  scrollbarThumb: graphite[800],
  scrollbarThumbHover: graphite[700],
} as const

export type SemanticTheme = { [K in keyof typeof dark]: string }
export type SemanticToken = keyof SemanticTheme

const light: SemanticTheme = {
  background: '#f2f2f2',
  foreground: '#262626',
  card: '#f9f9f9',
  cardForeground: '#262626',
  popover: '#fcfcfc',
  popoverForeground: '#262626',
  primary: '#262626',
  primaryForeground: '#fcfcfc',
  secondary: '#e7e7e7',
  secondaryForeground: '#262626',
  muted: '#e4e4e4',
  skeleton: '#d7d7d7',
  mutedForeground: graphite[600],
  accent: '#dddddd',
  accentForeground: '#262626',
  destructive: red[700],
  border: '#d5d5d5',
  input: '#d5d5d5',
  ring: graphite[500],

  chart1: steel[600],
  chart2: blue[600],
  chart3: green[600],
  chart4: amber[600],
  chart5: violet[600],

  sidebar: '#f9f9f9',
  sidebarForeground: '#262626',
  sidebarPrimary: '#262626',
  sidebarPrimaryForeground: '#fcfcfc',
  sidebarAccent: '#dddddd',
  sidebarAccentForeground: '#262626',
  sidebarBorder: '#d5d5d5',
  sidebarRing: graphite[500],

  success: green[600],
  successForeground: '#fcfcfc',
  prOpen: '#1a7f37',
  prDraft: '#59636e',
  prMerged: '#8250df',
  prClosed: '#cf222e',
  prQueued: '#9a6700',
  warning: amber[600],
  warningForeground: '#fcfcfc',

  code: graphite[700],
  codeBackground: '#e3e3e3',
  link: blue[700],

  diffAdd: diff.addLight,
  diffAddForeground: green[700],
  diffRemove: diff.removeLight,
  diffRemoveForeground: red[700],
  diffWord: diff.wordLight,
  diffBand: diff.bandLight,
  diffGutter: graphite[600],

  syntaxKeyword: violet[700],
  syntaxString: green[700],
  syntaxComment: graphite[500],
  syntaxFunction: blue[700],
  syntaxType: blue[700],
  syntaxConstant: amber[700],
  syntaxPunctuation: graphite[500],

  scrollbarThumb: '#d5d5d5',
  scrollbarThumbHover: graphite[400],
}

export const semantic: Record<EColorScheme, SemanticTheme> = {
  [EColorScheme.Dark]: dark,
  [EColorScheme.Light]: light,
}
