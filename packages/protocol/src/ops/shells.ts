import { z } from 'zod'

import { okResultSchema } from './result'

const envSchema = z.record(z.string(), z.string())

const shellIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]+$/)
  .refine((id) => id.replace(/\./g, '') !== '', 'a shell id cannot be only dots')

export enum EShellRunStatus {
  Running = 'running',
  Exited = 'exited',
  Killed = 'killed',
  TimedOut = 'timed-out',
  OomKilled = 'oom-killed',
}

export const shellInfoSchema = z
  .object({
    shellId: shellIdSchema,
    command: z.string().min(1),
    pid: z.number().int().min(0),
    startedAt: z.iso.datetime(),
    status: z.enum(EShellRunStatus),
    exitCode: z.number().int().nullable(),
    signal: z.string().min(1).nullable(),
    endedAt: z.iso.datetime().optional(),
    totalBytes: z.number().int().min(0),
  })
  .strict()

export const shellsLaunchOpSchema = z
  .object({
    op: z.literal('shells.launch'),
    shellId: shellIdSchema,
    command: z.string().min(1),
    cwd: z.string().min(1),
    env: envSchema.optional(),
    timeoutMs: z.number().int().min(1).optional(),
    outputLimitBytes: z.number().int().min(0).optional(),
    input: z.boolean().optional(),
  })
  .strict()

export const shellsReadOpSchema = z
  .object({
    op: z.literal('shells.read'),
    shellId: shellIdSchema,
    offset: z.number().int().min(0),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024),
  })
  .strict()

export const shellsWriteOpSchema = z
  .object({
    op: z.literal('shells.write'),
    shellId: shellIdSchema,
    data: z.string(),
    end: z.boolean().optional(),
  })
  .strict()

export const shellsKillOpSchema = z
  .object({ op: z.literal('shells.kill'), shellId: shellIdSchema })
  .strict()

export const shellsListOpSchema = z.object({ op: z.literal('shells.list') }).strict()

export const shellsReadResultSchema = z
  .object({
    offset: z.number().int().min(0),
    bytes: z.base64(),
    totalBytes: z.number().int().min(0),
    info: shellInfoSchema,
  })
  .strict()

export const shellsOpSchemas = [
  shellsLaunchOpSchema,
  shellsReadOpSchema,
  shellsWriteOpSchema,
  shellsKillOpSchema,
  shellsListOpSchema,
] as const

export const shellsResultSchemas = [
  okResultSchema({ op: 'shells.launch', value: shellInfoSchema }),
  okResultSchema({ op: 'shells.read', value: shellsReadResultSchema }),
  okResultSchema({ op: 'shells.write', value: z.null() }),
  okResultSchema({ op: 'shells.kill', value: shellInfoSchema }),
  okResultSchema({ op: 'shells.list', value: z.array(shellInfoSchema) }),
] as const

export const shellsOutputEventSchema = z
  .object({
    type: z.literal('shells.output'),
    shellId: shellIdSchema,
    totalBytes: z.number().int().min(0),
  })
  .strict()

export const shellsEndedEventSchema = z
  .object({ type: z.literal('shells.ended'), shellId: shellIdSchema, info: shellInfoSchema })
  .strict()

export const shellsEventSchemas = [shellsOutputEventSchema, shellsEndedEventSchema] as const

export type ShellInfo = z.infer<typeof shellInfoSchema>
export type ShellsLaunchOp = z.infer<typeof shellsLaunchOpSchema>
export type ShellsReadOp = z.infer<typeof shellsReadOpSchema>
export type ShellsWriteOp = z.infer<typeof shellsWriteOpSchema>
export type ShellsKillOp = z.infer<typeof shellsKillOpSchema>
export type ShellsListOp = z.infer<typeof shellsListOpSchema>
export type ShellsReadResult = z.infer<typeof shellsReadResultSchema>
export type ShellsOutputEvent = z.infer<typeof shellsOutputEventSchema>
export type ShellsEndedEvent = z.infer<typeof shellsEndedEventSchema>
