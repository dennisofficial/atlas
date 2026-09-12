export const text = {
  "2xs": { size: "10px", lineHeight: "14px" },
  xs: { size: "11px", lineHeight: "16px" },
  sm: { size: "12px", lineHeight: "18px" },
  base: { size: "13px", lineHeight: "20px" },
  md: { size: "14px", lineHeight: "21px" },
  lg: { size: "16px", lineHeight: "24px" },
  xl: { size: "18px", lineHeight: "26px" },
  "2xl": { size: "21px", lineHeight: "28px" },
  "3xl": { size: "26px", lineHeight: "32px" },
  "4xl": { size: "32px", lineHeight: "38px" },
} as const;

export const weight = {
  regular: "400",
  medium: "500",
  semibold: "600",
  bold: "700",
} as const;

export const tracking = {
  tight: "-0.012em",
  normal: "0em",
  wide: "0.04em",
  caps: "0.14em",
  wordmark: "0.16em",
} as const;

export const font = {
  display: '"Space Grotesk", "Futura", "Avenir Next", system-ui, sans-serif',
  sans: '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", "Menlo", "Consolas", monospace',
} as const;
