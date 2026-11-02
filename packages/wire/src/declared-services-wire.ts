import { z } from 'zod'

import { serviceSnapshotWireSchema } from './roster-wire'

export const declaredServiceStateWire = z.enum([
  'stopped',
  'starting',
  'running',
  'stale',
  'failed',
  'crash-looping',
])
export type DeclaredServiceStateWire = z.infer<typeof declaredServiceStateWire>

export const serviceTypeWire = z.enum(['web', 'api', 'database'])
export type ServiceTypeWire = z.infer<typeof serviceTypeWire>

export const declaredServiceLinkWireSchema = z.object({
  url: z.string(),
  title: z.string(),
  description: z.string().optional(),
})
export type DeclaredServiceLinkWire = z.infer<typeof declaredServiceLinkWireSchema>

export const declaredServiceViewWireSchema = z.object({
  name: z.string().min(1),
  state: declaredServiceStateWire,
  type: serviceTypeWire.optional(),
  serviceId: z.string().min(1).optional(),
  port: z.number().int().nonnegative().optional(),
  url: z.string().optional(),
  links: z.array(declaredServiceLinkWireSchema),
  logPath: z.string().optional(),
  reason: z.string().optional(),
})
export type DeclaredServiceViewWire = z.infer<typeof declaredServiceViewWireSchema>

export const declaredServicesViewWireSchema = z.object({
  services: z.array(declaredServiceViewWireSchema),
  rejections: z.array(z.object({ name: z.string().optional(), detail: z.string() })),
})
export type DeclaredServicesViewWire = z.infer<typeof declaredServicesViewWireSchema>

export const ensuredServiceWireSchema = z.object({
  name: z.string().min(1),
  status: z.string(),
  url: z.string().optional(),
  links: z.array(declaredServiceLinkWireSchema),
  ready: z.boolean(),
  reason: z.string().optional(),
})
export type EnsuredServiceWire = z.infer<typeof ensuredServiceWireSchema>

export const listDeclaredServicesParamsSchema = z.object({})
export type ListDeclaredServicesParams = z.infer<typeof listDeclaredServicesParamsSchema>

export const ensureDeclaredServicesParamsSchema = z.object({
  names: z.array(z.string().min(1)).optional(),
})
export type EnsureDeclaredServicesParams = z.infer<typeof ensureDeclaredServicesParamsSchema>

export const restartServiceParamsSchema = z.object({
  serviceId: z.string().min(1),
})
export type RestartServiceParams = z.infer<typeof restartServiceParamsSchema>

export const listDeclaredServicesReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), view: declaredServicesViewWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])
export type ListDeclaredServicesReply = z.infer<typeof listDeclaredServicesReplySchema>

export const ensureDeclaredServicesReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), results: z.array(ensuredServiceWireSchema) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])
export type EnsureDeclaredServicesReply = z.infer<typeof ensureDeclaredServicesReplySchema>

export const restartServiceReplySchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), snapshot: serviceSnapshotWireSchema }),
  z.object({ ok: z.literal(false), reason: z.string() }),
])
export type RestartServiceReply = z.infer<typeof restartServiceReplySchema>
