import { TextAttributes } from '@opentui/core'

type FrameSpan = {
  text: string
  fg: { r: number; g: number; b: number; a: number }
  bg: { r: number; g: number; b: number; a: number }
  attributes: number
}

export type FrameForHtml = {
  cols: number
  rows: number
  lines: readonly { spans: readonly FrameSpan[] }[]
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const CHANNEL_MAX = 255

const channel = (value: number): number =>
  Math.min(CHANNEL_MAX, Math.max(0, Math.round(value * CHANNEL_MAX)))

const hex = (colour: { r: number; g: number; b: number }): string =>
  `#${[colour.r, colour.g, colour.b].map((one) => channel(one).toString(16).padStart(2, '0')).join('')}`

function spanHtml(span: FrameSpan): string {
  const style: string[] = []
  if (span.fg.a > 0) style.push(`color:${hex(span.fg)}`)
  if (span.bg.a > 0) style.push(`background-color:${hex(span.bg)}`)
  if ((span.attributes & TextAttributes.DIM) !== 0) style.push('opacity:0.55')
  if ((span.attributes & TextAttributes.BOLD) !== 0) style.push('font-weight:bold')
  if ((span.attributes & TextAttributes.ITALIC) !== 0) style.push('font-style:italic')
  if ((span.attributes & TextAttributes.UNDERLINE) !== 0) style.push('text-decoration:underline')
  if ((span.attributes & TextAttributes.STRIKETHROUGH) !== 0) style.push('text-decoration:line-through')

  if (style.length === 0) return escapeHtml(span.text)
  return `<span style="${style.join(';')}">${escapeHtml(span.text)}</span>`
}

export function frameToHtml(args: { frame: FrameForHtml; title: string }): string {
  const rows = args.frame.lines
    .map((line) => line.spans.map((span) => spanHtml(span)).join(''))
    .join('\n')

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(args.title)}</title>`,
    '<style>',
    'body{margin:0;padding:24px;background:#282422;display:flex;justify-content:center}',
    `pre{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.35;white-space:pre;color:#c8b5ad}`,
    '</style>',
    '</head>',
    '<body>',
    `<pre>${rows}</pre>`,
    '</body>',
    '</html>',
  ].join('\n')
}
