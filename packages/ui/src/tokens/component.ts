import { control, radius } from "./scale";

export const component = {
  button: {
    radius: radius.md,
    height: control.md,
  },
  input: {
    radius: radius.md,
    height: control.md,
  },
  card: {
    radius: radius.lg,
  },
} as const;

export type ComponentTokens = typeof component;
