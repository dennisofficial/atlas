import { z } from 'zod'

import { EClassifierFault } from '@dltech/atlas-core'

export const classifierTestOutputSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), model: z.string(), ms: z.number().int().nonnegative() }),
  z.object({ ok: z.literal(false), fault: z.enum(EClassifierFault), detail: z.string() }),
])

export type ClassifierTestOutput = z.infer<typeof classifierTestOutputSchema>
