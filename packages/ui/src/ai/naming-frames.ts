export const NAMING_SETTLE_MS = 400

export const NAMING_NOISE = '····:∙'

const noiseGlyph = (random: () => number): string =>
  NAMING_NOISE[Math.floor(random() * NAMING_NOISE.length)] ?? '·'

export function noiseLine(args: { length: number; random: () => number }): string {
  return Array.from({ length: Math.max(0, args.length) }, () => noiseGlyph(args.random)).join('')
}

export function streamingLine(args: {
  title: string
  startLength: number
  elapsedMs: number
  settleMs: number
  random: () => number
}): string {
  const glyphs = [...args.title]
  const progress = Math.max(0, Math.min(1, args.elapsedMs / args.settleMs))
  if (progress >= 1) return args.title
  const cells = Math.max(
    1,
    Math.round(args.startLength + (glyphs.length - args.startLength) * progress),
  )
  const resolved = Math.min(cells, Math.floor(progress * glyphs.length))
  return (
    glyphs.slice(0, resolved).join('') +
    noiseLine({ length: cells - resolved, random: args.random })
  )
}
