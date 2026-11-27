import { z } from 'zod'

export type PreviewsReady = { type: 'previews-ready'; at: string }

declare module '@dltech/atlas-core' {
  interface PluginEventBodies {
    'previews-ready': PreviewsReady
  }
}

export const previewsReadySchema: z.ZodType<PreviewsReady> = z.object({
  type: z.literal('previews-ready'),
  at: z.string().min(1),
})
