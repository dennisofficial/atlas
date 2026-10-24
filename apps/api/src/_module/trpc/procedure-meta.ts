import { z } from 'zod'

const throttleSchema = z.union([
  z.object({ limit: z.number().int().positive(), ttlMs: z.number().int().positive() }),
  z.literal(false),
])

const apiProcedureMetaSchema = z.object({
  podReachable: z.literal(true).optional(),
  sandboxReachable: z.literal(true).optional(),
  public: z.literal(true).optional(),
  throttle: throttleSchema.optional(),
})

export type ApiProcedureMeta = z.infer<typeof apiProcedureMetaSchema>

export const meta = (value: ApiProcedureMeta): ApiProcedureMeta => value

export const metaOf = (raw: unknown): ApiProcedureMeta => {
  const parsed = apiProcedureMetaSchema.safeParse(raw)
  return parsed.success ? parsed.data : {}
}
