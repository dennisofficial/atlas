import { primitives } from "./primitives";

const { color } = primitives;

export enum EColorScheme {
  Light = "light",
  Dark = "dark",
}

const light = {
  background: color.white,
  foreground: color.gray[950],
  card: color.white,
  cardForeground: color.gray[950],
  popover: color.white,
  popoverForeground: color.gray[950],
  primary: color.accent[600],
  primaryForeground: color.white,
  secondary: color.gray[100],
  secondaryForeground: color.gray[900],
  muted: color.gray[100],
  mutedForeground: color.gray[500],
  accent: color.gray[100],
  accentForeground: color.gray[900],
  destructive: color.red[600],
  destructiveForeground: color.white,
  success: color.green[600],
  warning: color.amber[600],
  border: color.gray[200],
  input: color.gray[200],
  ring: color.accent[600],
} as const;

export type SemanticTheme = { [K in keyof typeof light]: string };
export type SemanticToken = keyof SemanticTheme;

const dark: SemanticTheme = {
  background: color.gray[950],
  foreground: color.gray[50],
  card: color.gray[900],
  cardForeground: color.gray[50],
  popover: color.gray[900],
  popoverForeground: color.gray[50],
  primary: color.accent[500],
  primaryForeground: color.white,
  secondary: color.gray[800],
  secondaryForeground: color.gray[50],
  muted: color.gray[800],
  mutedForeground: color.gray[400],
  accent: color.gray[800],
  accentForeground: color.gray[50],
  destructive: color.red[600],
  destructiveForeground: color.white,
  success: color.green[500],
  warning: color.amber[500],
  border: color.gray[800],
  input: color.gray[800],
  ring: color.accent[500],
};

export const semantic: Record<EColorScheme, SemanticTheme> = {
  [EColorScheme.Light]: light,
  [EColorScheme.Dark]: dark,
};
