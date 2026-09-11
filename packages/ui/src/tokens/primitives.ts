const gray = {
  50: "#f8fafc",
  100: "#f1f5f9",
  200: "#e2e8f0",
  300: "#cbd5e1",
  400: "#94a3b8",
  500: "#64748b",
  600: "#475569",
  700: "#334155",
  800: "#1e293b",
  900: "#0f172a",
  950: "#020617",
} as const;

const accent = {
  50: "#eff6ff",
  100: "#dbeafe",
  200: "#bfdbfe",
  300: "#93c5fd",
  400: "#60a5fa",
  500: "#3b82f6",
  600: "#2563eb",
  700: "#1d4ed8",
  800: "#1e40af",
  900: "#1e3a8a",
  950: "#172554",
} as const;

const red = {
  500: "#ef4444",
  600: "#dc2626",
  700: "#b91c1c",
} as const;

const green = {
  500: "#22c55e",
  600: "#16a34a",
} as const;

const amber = {
  500: "#f59e0b",
  600: "#d97706",
} as const;

export const primitives = {
  color: {
    white: "#ffffff",
    black: "#000000",
    gray,
    accent,
    red,
    green,
    amber,
  },
  radius: {
    sm: "0.25rem",
    md: "0.375rem",
    lg: "0.5rem",
    xl: "0.75rem",
    full: "9999px",
  },
  font: {
    sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace",
  },
} as const;

export type Primitives = typeof primitives;
