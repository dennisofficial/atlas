import { cloudOutageMessage } from './cloud-outage'

export const BOOT_FAILURE_EXIT_CODE = 1

const HEADLINE = 'Atlas could not start.'

const STACK_HINT = 'Set ATLAS_DEBUG=1 to see the stack.'

const MAX_WIDTH = 92

const detailOf = (error: unknown): string => {
  const outage = cloudOutageMessage(error)
  if (outage !== null) return outage
  if (error instanceof Error) return error.message
  return String(error)
}

const chunked = (word: string, width: number): readonly string[] => {
  const pieces: string[] = []
  for (let at = 0; at < word.length; at += width) pieces.push(word.slice(at, at + width))
  return pieces
}

const wrap = (line: string, width: number): readonly string[] => {
  if (line.length <= width) return [line]

  const wrapped: string[] = []
  let current = ''
  for (const word of line.split(' ').flatMap((part) => chunked(part, width))) {
    if (current.length === 0) {
      current = word
      continue
    }
    if (current.length + 1 + word.length > width) {
      wrapped.push(current)
      current = word
      continue
    }
    current = `${current} ${word}`
  }
  if (current.length > 0) wrapped.push(current)
  return wrapped
}

export function bootFailureReport(args: { error: unknown; debug: boolean }): string {
  const body = [HEADLINE, '', ...detailOf(args.error).split('\n')]
  const lines = body.flatMap((line) => wrap(line, MAX_WIDTH - 4))
  const width = Math.min(MAX_WIDTH, Math.max(...lines.map((line) => line.length)) + 4)
  const inner = width - 4

  const framed = [
    `╭${'─'.repeat(width - 2)}╮`,
    ...lines.map((line) => `│ ${line.padEnd(inner, ' ')} │`),
    `╰${'─'.repeat(width - 2)}╯`,
  ]

  const stack =
    args.debug && args.error instanceof Error && args.error.stack !== undefined
      ? ['', args.error.stack]
      : ['', STACK_HINT]

  return `${[...framed, ...stack].join('\n')}\n`
}
