import { z } from 'zod'

import type { V2Event } from './event'

export const resourceLoadedSchema = z.object({
  type: z.literal('resource-loaded'),
  resource: z.string().min(1),
  fingerprint: z.string().min(1),
  value: z.unknown(),
})

export type ResourceLoaded = {
  type: 'resource-loaded'
  resource: string
  fingerprint: string
  value: unknown
}

export type ResourceSnapshot = { fingerprint: string; value: unknown }

export const latestResourceOf = (args: {
  events: readonly V2Event[]
  resource: string
}): ResourceSnapshot | undefined => {
  for (let index = args.events.length - 1; index >= 0; index -= 1) {
    const event = args.events[index]
    if (event === undefined || event.type !== 'resource-loaded') continue
    if (event.resource !== args.resource) continue
    return { fingerprint: event.fingerprint, value: event.value }
  }
  return undefined
}

export const loadedUnderCloudOf = (args: {
  fingerprint: string
  cloud: string
  directory: string
}): boolean => args.fingerprint.endsWith(`:${args.cloud}:${args.directory}`)

export const resourceFingerprintOf = (args: {
  instance: string
  seq: number | undefined
  cloud: string
  directory: string
}): string => `${args.instance}:${args.seq ?? 'unarmed'}:${args.cloud}:${args.directory}`
