import { z } from 'zod'

const envSchema = z.record(z.string(), z.string())

export const execOpSchema = z
  .object({
    op: z.literal('exec'),
    argv: z.array(z.string().min(1)).min(1).readonly(),
    cwd: z.string().min(1).optional(),
    env: envSchema.optional(),
    timeoutMs: z.number().int().min(1).optional(),
  })
  .strict()

export type ExecOp = z.infer<typeof execOpSchema>
