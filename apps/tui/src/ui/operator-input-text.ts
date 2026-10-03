export const operatorEditorText = (text: string): string => text.replace(/\r\n?/g, '\n')

function sourceOffset(args: { text: string; offset: number }): number {
  let source = 0
  let normalized = 0
  while (source < args.text.length && normalized < args.offset) {
    if (args.text[source] === '\r' && args.text[source + 1] === '\n') source++
    source++
    normalized++
  }
  return source
}

export function operatorTextWithPaste(args: { source: string; start: number; end: number; pasted: string }): string {
  const sourceStart = sourceOffset({ text: args.source, offset: args.start })
  const sourceEnd = sourceOffset({ text: args.source, offset: args.end })
  return args.source.slice(0, sourceStart) + args.pasted + args.source.slice(sourceEnd)
}

export function operatorTextAfterEdit(args: { source: string; edited: string }): string {
  const before = operatorEditorText(args.source)
  const after = args.edited
  if (before === after) return args.source

  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++

  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--
    afterEnd--
  }
  const sourceStart = sourceOffset({ text: args.source, offset: start })
  const sourceEnd = sourceOffset({ text: args.source, offset: beforeEnd })
  return args.source.slice(0, sourceStart) + after.slice(start, afterEnd) + args.source.slice(sourceEnd)
}
