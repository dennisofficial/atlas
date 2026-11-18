import type { ToolOutcome } from '@dltech/atlas-core'

export const fail = (reason: string): ToolOutcome => ({ ok: false, reason })

export const done = (args: { text: string; output?: unknown }): ToolOutcome => ({
  ok: true,
  output: args.output ?? { message: args.text },
  modelText: args.text,
})

export const listing = (args: { title: string; lines: readonly string[] }): ToolOutcome =>
  done({
    text:
      args.lines.length === 0 ? `No ${args.title}.` : `${args.title}:\n${args.lines.join('\n')}`,
    output: { count: args.lines.length },
  })

export const foreignProject = (args: { own: string; bound: string }): ToolOutcome | undefined =>
  args.own === args.bound
    ? undefined
    : fail(`this session can only change its own project (${args.own}), not ${args.bound}`)

export const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
