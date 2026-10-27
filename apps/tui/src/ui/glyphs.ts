export const glyph = {
  user: '❯',
  block: '⏺',
  result: '⎿',
  thinking: '✻',
  swap: '⤿',
  selected: '❯',
  marker: '▸',
  active: '⏺',
  available: '○',
  unseen: '●',
  live: '●',
  held: '◷',
  attention: '!',
  collapsed: '▸',
  expanded: '▾',
  seen: '·',
  warning: '⚠',
  failed: '✗',
  passed: '✓',
  image: '▣',
  skill: '◆',
  file: '⬚',
  document: '▤',
  external: '↗',
  copy: '⧉',
  retry: '↻',
  home: '⌂',
  worktree: '⑂',
} as const

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

export const SPINNER_FRAME_MS = 80

export function spinnerFrame(nowMs: number): string {
  const index = Math.floor(nowMs / SPINNER_FRAME_MS) % SPINNER_FRAMES.length
  return SPINNER_FRAMES[index] as string
}

export const WORKING_TITLE_FRAMES = SPINNER_FRAMES

export const WORKING_TITLE_FRAME_MS = 80

export const IDLE_TITLE_GLYPH = '◦'

export const NEEDS_OPERATOR_TITLE_GLYPH = '●'

export function workingTitleFrame(nowMs: number): string {
  const index = Math.floor(nowMs / WORKING_TITLE_FRAME_MS) % WORKING_TITLE_FRAMES.length
  return WORKING_TITLE_FRAMES[index] as string
}
