import { primitives } from "./primitives";

export const component = {
  button: {
    radius: primitives.radius.md,
  },
  input: {
    radius: primitives.radius.md,
  },
  card: {
    radius: primitives.radius.lg,
  },
} as const;

export type ComponentTokens = typeof component;
