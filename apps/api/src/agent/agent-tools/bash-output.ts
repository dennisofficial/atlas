import {
  OOM_ADVICE,
  memoryLimitNote,
  ONLY_OPERATOR_RAISES_MEMORY,
  untrustedEnvelope,
  type OomMemory,
} from '@dltech/atlas-core'

import { ceilingClause } from './bash-prose'
import { countLineBreaks, render, type Tail } from './shell-process'

export const MAXIMUM_OUTPUT_CHARACTERS = 30_000

const HALF_OUTPUT_CHARACTERS = Math.floor(MAXIMUM_OUTPUT_CHARACTERS / 2)
function budgetsFor(args: { stdout: number; stderr: number }): { stdout: number; stderr: number } {
  if (args.stdout + args.stderr <= MAXIMUM_OUTPUT_CHARACTERS) return args
  if (args.stdout <= HALF_OUTPUT_CHARACTERS) {
    return { stdout: args.stdout, stderr: MAXIMUM_OUTPUT_CHARACTERS - args.stdout }
  }
  if (args.stderr <= HALF_OUTPUT_CHARACTERS) {
    return { stdout: MAXIMUM_OUTPUT_CHARACTERS - args.stderr, stderr: args.stderr }
  }

  return {
    stdout: HALF_OUTPUT_CHARACTERS,
    stderr: MAXIMUM_OUTPUT_CHARACTERS - HALF_OUTPUT_CHARACTERS,
  }
}

const withoutTrailingBreaks = (text: string): string => text.replace(/\n+$/, '')

function clampTail(args: { tail: Tail; budget: number }): Tail {
  const text = withoutTrailingBreaks(args.tail.text)
  if (text.length <= args.budget) return { ...args.tail, text }

  const kept = text.slice(-args.budget)
  return {
    text: kept,
    droppedLines:
      args.tail.droppedLines + countLineBreaks(text.slice(0, text.length - kept.length)),
    truncated: true,
  }
}

export function mergeStreams(args: { stdout: Tail; stderr: Tail }): {
  text: string
  truncated: boolean
} {
  const budgets = budgetsFor({
    stdout: withoutTrailingBreaks(args.stdout.text).length,
    stderr: withoutTrailingBreaks(args.stderr.text).length,
  })

  const streams = [
    clampTail({ tail: args.stdout, budget: budgets.stdout }),
    clampTail({ tail: args.stderr, budget: budgets.stderr }),
  ]

  const text = streams
    .filter((stream) => stream.text.length > 0)
    .map(render)
    .join('\n')
    .replace(/^(?:[^\S\n]*\n)+/, '')
    .trimEnd()

  return { text, truncated: streams.some((stream) => stream.truncated) }
}

export function renderBackgroundedText(args: {
  command: string
  shellId: string
  merged: string
  timeoutMs: number
}): string {
  const sections: string[] = []
  if (args.merged.length > 0)
    sections.push(untrustedEnvelope({ source: 'bash', body: args.merged }))
  sections.push(
    `\`${args.command}\` is still running after ${args.timeoutMs / 1000} s, so it continues as background shell ${args.shellId} instead of being killed. Its ending is delivered to you with the output from here on. Use shell_output({ shellId: "${args.shellId}" }) for unread output. Use shell_kill to stop it. Do not wait on it: take other work, or end the turn and be woken.`,
  )
  return sections.join('\n\n')
}

export function renderStartedText(args: {
  shellId: string
  timeoutMs: number | undefined
  input: boolean
}): string {
  return [
    `Started in the background as shell ${args.shellId}, and it outlives this turn and an interrupt.`,
    'Its ending arrives on its own with its output, even after this turn ends.',
    'So do not wait on it: no sleeping, no polling, no idle loop - a tick only spins the turn. Take other work, or end the turn and be woken.',
    ...ceilingClause({ timeoutMs: args.timeoutMs }),
    `Use shell_output({ shellId: "${args.shellId}" }) for unread output. Use shell_kill to stop it.`,
    ...(args.input
      ? ['Its stdin is open: shell_input answers a prompt, with a trailing newline.']
      : []),
  ].join(' ')
}

export function renderModelText(args: {
  command: string
  merged: string
  exitCode: number
  timedOut: boolean
  oomKilled: boolean
  memory: OomMemory | undefined
  timeoutMs: number
  maximumTimeoutMs: number
}): string {
  const sections: string[] = []
  if (args.merged.length > 0)
    sections.push(untrustedEnvelope({ source: 'bash', body: args.merged }))
  if (args.timedOut) {
    sections.push(
      `The command was killed after exceeding its ${args.timeoutMs} ms timeout. This sandbox could not keep it running in the background. If it needs longer than ${args.maximumTimeoutMs} ms, start it with \`background: true\`. Its ending is delivered to you whenever it lands.`,
    )
  }
  if (args.oomKilled) {
    sections.push(
      `The kernel killed \`${args.command}\` because it ran out of memory${memoryLimitNote(args.memory)}. ${OOM_ADVICE} ${ONLY_OPERATOR_RAISES_MEMORY}`,
    )
  }
  if (args.exitCode !== 0) sections.push(`Exit code: ${args.exitCode}`)
  if (sections.length === 0) return 'The command completed with no output.'
  return sections.join('\n\n')
}
