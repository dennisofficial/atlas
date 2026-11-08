import type { z } from 'zod'

import type {
  ClientSlot,
  CommandSpec,
  ControlSlot,
  PluginTransport,
  PodSlot,
  ViewFold,
} from './slots'

export type PluginSlots = {
  events: readonly z.ZodType[]
  views: readonly ViewFold[]
  commands: readonly CommandSpec[]
  pod: PodSlot
  control: ControlSlot
  client: ClientSlot
  transport: PluginTransport
}

export type Plugin = Readonly<{ name: string } & PluginSlots>

export type ComposedPlugins = {
  names: readonly string[]
  eventBodies: readonly z.ZodType[]
  views: readonly ViewFold[]
  commands: readonly CommandSpec[]
  pod: PodSlot
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
    pod: Object.freeze({ handlers: Object.freeze(plugins.flatMap((p) => p.pod.handlers)) }),
    control: Object.freeze({ hooks: Object.freeze(plugins.flatMap((p) => p.control.hooks)) }),
    client: Object.freeze({ hooks: Object.freeze(plugins.flatMap((p) => p.client.hooks)) }),
    transports: Object.freeze(plugins.map((plugin) => plugin.transport)),
  })
