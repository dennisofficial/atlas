import { z } from 'zod'

import { okResultSchema } from './result'

const envSchema = z.record(z.string(), z.string())

export enum EExecOutcome {
  Exited = 'exited',
  Cancelled = 'cancelled',
  TimedOut = 'timed-out',
  OomKilled = 'oom-killed',
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
  })
  .strict()

export const execOpSchemas = [execOpSchema] as const
export const execResultSchemas = [okResultSchema({ op: 'exec', value: execResultSchema })] as const
export const execOomKillEventSchema = z
  .object({ type: z.literal('exec.oom-kill'), key: z.string().min(1) })
  .strict()

export const execEventSchemas = [execOomKillEventSchema] as const

export type ExecOp = z.infer<typeof execOpSchema>
export type ExecResult = z.infer<typeof execResultSchema>
export type ExecOomKillEvent = z.infer<typeof execOomKillEventSchema>
