import type { Event, RecordEvent } from '@dltech/atlas-core'
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

export const latestPreviewsReadyAt = (
  events: readonly (Event | RecordEvent)[],
): string | undefined => {
  let latest: string | undefined
  for (const event of events) if (event.type === 'previews-ready') latest = event.at
  return latest
}

export const hasPreviewsReady = (args: {
  events: readonly (Event | RecordEvent)[]
  at: string
}): boolean => args.events.some((event) => event.type === 'previews-ready' && event.at === args.at)
