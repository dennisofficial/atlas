import { z } from 'zod'

export type ServiceReady = { type: 'service-ready'; serviceId: string }

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'service-ready': ServiceReady
  }
}

export const serviceReadySchema: z.ZodType<ServiceReady> = z.object({
  type: z.literal('service-ready'),
  serviceId: z.string().min(1),
})
