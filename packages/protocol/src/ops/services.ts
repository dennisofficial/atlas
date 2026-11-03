import { z } from 'zod'

import { okResultSchema } from './result'

export enum EServiceRunStatus {
  Starting = 'starting',
  Ready = 'ready',
  Exited = 'exited',
  Stopped = 'stopped',
  OomKilled = 'oom-killed',
}

const serviceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]+$/)
  .refine((id) => id.replace(/\./g, '') !== '', 'a service id cannot be only dots')

const envSchema = z.record(z.string(), z.string())

export const servicesStartOpSchema = z
  .object({
    op: z.literal('services.start'),
    serviceId: serviceIdSchema,
    command: z.string().min(1),
    cwd: z.string().min(1),
    env: envSchema.optional(),
    port: z.number().int().min(1).max(65535).optional(),
    readyTimeoutMs: z.number().int().min(1).optional(),
  })
  .strict()

export const servicesStopOpSchema = z
  .object({ op: z.literal('services.stop'), serviceId: serviceIdSchema })
  .strict()

export const servicesListOpSchema = z.object({ op: z.literal('services.list') }).strict()

export const servicesLogOpSchema = z
  .object({
    op: z.literal('services.log'),
    serviceId: serviceIdSchema,
    offset: z.number().int().min(0),
    limit: z.number().int().min(1),
  })
  .strict()

export const serviceInfoSchema = z
  .object({
    serviceId: serviceIdSchema,
    command: z.string().min(1),
    pid: z.number().int().min(1),
    port: z.number().int().min(1).max(65535).nullable(),
    status: z.enum(EServiceRunStatus),
    exitCode: z.number().int().nullable(),
    signal: z.string().min(1).nullable(),
    startedAt: z.number(),
    endedAt: z.number().optional(),
  })
  .strict()

export const servicesLogResultSchema = z
  .object({
    offset: z.number().int().min(0),
    bytes: z.base64(),
    totalBytes: z.number().int().min(0),
  })
  .strict()

export const servicesOpSchemas = [
  servicesStartOpSchema,
  servicesStopOpSchema,
  servicesListOpSchema,
  servicesLogOpSchema,
] as const

export const servicesResultSchemas = [
  okResultSchema({ op: 'services.start', value: serviceInfoSchema }),
  okResultSchema({ op: 'services.stop', value: serviceInfoSchema }),
  okResultSchema({ op: 'services.list', value: z.array(serviceInfoSchema) }),
  okResultSchema({ op: 'services.log', value: servicesLogResultSchema }),
] as const

export const servicesReadyEventSchema = z
  .object({ type: z.literal('services.ready'), serviceId: serviceIdSchema })
  .strict()

export const servicesEndedEventSchema = z
  .object({
    type: z.literal('services.ended'),
    serviceId: serviceIdSchema,
    info: serviceInfoSchema,
  })
  .strict()

export const servicesEventSchemas = [servicesReadyEventSchema, servicesEndedEventSchema] as const

export type ServicesStartOp = z.infer<typeof servicesStartOpSchema>
export type ServicesStopOp = z.infer<typeof servicesStopOpSchema>
export type ServicesListOp = z.infer<typeof servicesListOpSchema>
export type ServicesLogOp = z.infer<typeof servicesLogOpSchema>
export type ServiceInfo = z.infer<typeof serviceInfoSchema>
export type ServicesLogResult = z.infer<typeof servicesLogResultSchema>
export type ServicesReadyEvent = z.infer<typeof servicesReadyEventSchema>
export type ServicesEndedEvent = z.infer<typeof servicesEndedEventSchema>
