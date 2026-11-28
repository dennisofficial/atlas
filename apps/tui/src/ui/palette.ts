export const ACCENT = '#eaeaea'

export const CODE_BLUE = '#7cbdff'

/** The steel blue the legacy web app used for its `--blue` token in dark mode. */
export const SERVICE_BLUE = '#7d9be0'

export type DiffTints = {
  addBg: string
  removeBg: string
  wordBg: string
  bandBg: string
  gutterFg: string
}

export type Palette = {
  appBg: string
  accent: string
  dim: string
  hover: string
  bright: string
  body: string
  rule: string
  hint: string
  meta: string
  hoverBg: string
  selectedBg: string
  error: string
  warn: string
  ok: string
  okBright: string
  userBg: string
  userFg: string
  userBand: string
  harnessBg: string
  harnessFg: string
  caretBg: string
  caretFg: string
  overlayBg: string
  panelBg: string
  panelBand: string
  code: string
  link: string
  codeInline: string
  court: {
    agent: string
    yours: string
    external: string
    none: string
  }
  diff: DiffTints
}

export const theme: Palette = {
  appBg: '#252525',
  accent: ACCENT,
  dim: '#646464',
  hover: '#eaeaea',
  bright: '#eaeaea',
  body: '#b9b9b9',
  rule: '#363636',
  hint: '#646464',
  meta: '#828282',
  hoverBg: '#282828',
  selectedBg: '#343434',
  error: '#e5534b',
  warn: '#e3b341',
  ok: '#57ab5a',
  okBright: '#7ee787',
  userBg: '#2f2f2f',
  userFg: '#eaeaea',
  userBand: '#282828',
  harnessBg: '#282828',
  harnessFg: '#eaeaea',
  caretBg: ACCENT,
  caretFg: '#202020',
  overlayBg: '#202020',
  panelBg: '#1b1b1b',
  panelBand: '#202020',
  code: CODE_BLUE,
  link: CODE_BLUE,
  codeInline: ACCENT,
  court: {
    agent: ACCENT,
    yours: ACCENT,
    external: '#b392f0',
    none: '#646464',
  },
  diff: {
    addBg: '#252d20',
    removeBg: '#322020',
    wordBg: '#335030',
    bandBg: '#202020',
    gutterFg: '#828282',
  },
}

export const SHIPPED_PALETTE: Palette = structuredClone(theme)
