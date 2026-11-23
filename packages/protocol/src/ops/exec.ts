import { z } from 'zod'

import { oomMemorySchema } from './oom'
import { okResultSchema } from './result'
import { shellInfoSchema } from './shells'

const envSchema = z.record(z.string(), z.string())

export enum EExecOutcome {
  Exited = 'exited',
  Cancelled = 'cancelled',
  TimedOut = 'timed-out',
  OomKilled = 'oom-killed',
  Backgrounded = 'backgrounded',
}

export const execOpSchema = z
  .object({
    op: z.literal('exec'),
    argv: z.array(z.string().min(1)).min(1).readonly(),
    cwd: z.string().min(1).optional(),
    env: envSchema.optional(),
    timeoutMs: z.number().int().min(1).optional(),
  })
  .strict()

export const execResultSchema = z
  .object({
    exitCode: z.number().int().nullable(),
    signal: z.string().min(1).nullable(),
    outcome: z.enum(EExecOutcome),
    outputBytes: z.number().int().min(0),
    memory: oomMemorySchema.optional(),
    shellId: z.string().min(1).optional(),
  })
  .strict()

export const execBackgroundOpSchema = z
  .object({
    op: z.literal('exec.background'),
    execKey: z.string().min(1),
    shellId: z.string().regex(/^[A-Za-z0-9_.:-]+$/),
  })
  .strict()

export const execBackgroundResultSchema = z
  .object({ adopted: z.boolean(), info: shellInfoSchema.optional() })
  .strict()

export const execOpSchemas = [execOpSchema, execBackgroundOpSchema] as const
export const execResultSchemas = [
  okResultSchema({ op: 'exec', value: execResultSchema }),
  okResultSchema({ op: 'exec.background', value: execBackgroundResultSchema }),
] as const
export const execOomKillEventSchema = z
  .object({ type: z.literal('exec.oom-kill'), key: z.string().min(1) })
  .strict()

export const execEventSchemas = [execOomKillEventSchema] as const

export type ExecOp = z.infer<typeof execOpSchema>
export type ExecResult = z.infer<typeof execResultSchema>
export type ExecBackgroundOp = z.infer<typeof execBackgroundOpSchema>
export type ExecBackgroundResult = z.infer<typeof execBackgroundResultSchema>
export type ExecOomKillEvent = z.infer<typeof execOomKillEventSchema>
