import type { Command } from '@dltech/atlas-commands'
import { createV2EventSchema, type PluginViewFold, type V2Event } from '@dltech/atlas-core'
import type { z } from 'zod'

import { composePod, mergeMaps, type ComposedPod } from './compose-pod'
import type { ClientSlot, ControlSlot, PluginTransport, PodSlot } from './slots'

export type PluginSlots = {
  events: readonly z.ZodType[]
  views: readonly PluginViewFold[]
  commands: readonly Command[]
  pod: PodSlot
  control: ControlSlot
  client: ClientSlot
  transport: PluginTransport
}

export type Plugin = Readonly<{ name: string } & PluginSlots>

export type ComposedPlugins = {
  names: readonly string[]
  eventBodies: readonly z.ZodType[]
  views: readonly PluginViewFold[]
  commands: readonly Command[]
  pod: ComposedPod
  control: ControlSlot
  client: ClientSlot
  transports: readonly PluginTransport[]
}

const SLOT_KEYS = [
  'events',
  'views',
  'commands',
  'pod',
  'control',
  'client',
  'transport',
] as const satisfies readonly (keyof PluginSlots)[]

export class MissingPluginSlotError extends Error {
  constructor(params: { plugin: string; slot: string }) {
    super(`plugin ${params.plugin} does not declare the ${params.slot} slot`)
    this.name = 'MissingPluginSlotError'
  }
}

export const definePlugin = (plugin: { name: string } & PluginSlots): Plugin => {
  for (const slot of SLOT_KEYS) {
    if (plugin[slot] === undefined) throw new MissingPluginSlotError({ plugin: plugin.name, slot })
  }
  return Object.freeze({ ...plugin })
}

export const composePlugins = (plugins: readonly Plugin[]): ComposedPlugins =>
  Object.freeze({
    names: Object.freeze(plugins.map((plugin) => plugin.name)),
    eventBodies: Object.freeze(plugins.flatMap((plugin) => plugin.events)),
    views: Object.freeze(plugins.flatMap((plugin) => plugin.views)),
    commands: Object.freeze(plugins.flatMap((plugin) => plugin.commands)),
    pod: composePod(plugins.map((plugin) => plugin.pod)),
    control: Object.freeze({
      hooks: Object.freeze(plugins.flatMap((plugin) => plugin.control.hooks)),
      commands: mergeMaps({
        maps: plugins.map((plugin) => plugin.control.commands),
        what: 'the control command',
      }),
    }),
    client: Object.freeze({ hooks: Object.freeze(plugins.flatMap((p) => p.client.hooks)) }),
    transports: Object.freeze(plugins.map((plugin) => plugin.transport)),
  })

export const eventSchemaOf = (plugins: readonly Plugin[]): z.ZodType<V2Event> =>
  createV2EventSchema({ pluginBodies: composePlugins(plugins).eventBodies })
