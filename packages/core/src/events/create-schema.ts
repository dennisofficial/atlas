import { z } from 'zod'

import type { EventBody } from './body'
import type { PluginEventBody } from './plugin-registry'
import { eventBodySchema } from './schema'

export type EventBodySchemaArgs = { pluginBodies?: readonly z.ZodType[] }

export const createEventBodySchema = ({
  pluginBodies = [],
}: EventBodySchemaArgs = {}): z.ZodType<EventBody | PluginEventBody> => {
  if (pluginBodies.length === 0) return eventBodySchema
  return z.unknown().transform((raw, ctx) => {
    const core = eventBodySchema.safeParse(raw)
    if (core.success) return core.data
    for (const schema of pluginBodies) {
      const plugin = schema.safeParse(raw)
      if (plugin.success) return plugin.data as PluginEventBody
    }
    for (const issue of core.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path })
    }
    return z.NEVER
  })
}
