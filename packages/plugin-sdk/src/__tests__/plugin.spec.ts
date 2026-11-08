import { describe, expect, it } from 'bun:test'
import {
  chainEvents,
  createV2EventSchema,
  toRunId,
  toThreadId,
  v2EventSchema,
} from '@dltech/atlas-core'
import type { V2Body, V2Event } from '@dltech/atlas-core'

import { composePlugins, definePlugin, MissingPluginSlotError } from '..'
import { fixtureLabelsView, fixtureObservedSchema, fixturePlugin } from './fixture-plugin'

const mintWire = (bodies: V2Body[]): unknown[] =>
  JSON.parse(
    JSON.stringify(
      chainEvents({
        threadId: toThreadId('thread-1'),
        runId: toRunId('run-1'),
        epoch: 1,
        at: '2026-11-02T12:00:00.000Z',
        bodies,
      }),
    ),
  )

const observed: V2Body = { type: 'fixture-observed', label: 'first' }

describe('plugin event registry', () => {
  it('round-trips a plugin event through the composed decoder', () => {
    const composed = composePlugins([fixturePlugin])
    const schema = createV2EventSchema({ pluginBodies: composed.eventBodies })
    const [wire] = mintWire([observed])
    const parsed = schema.safeParse(wire)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({ type: 'fixture-observed', label: 'first', seq: 1 })
  })

  it('still decodes core and record bodies through the composed decoder', () => {
    const schema = createV2EventSchema({ pluginBodies: [fixtureObservedSchema] })
    const wires = mintWire([
      { type: 'user-said', text: 'hi' },
      { type: 'history-rewound', toSeq: 0 },
    ])
    for (const wire of wires) expect(schema.safeParse(wire).success).toBe(true)
  })

  it('leaves the default decoder rejecting the plugin event as one unreadable row', () => {
    const [wire] = mintWire([observed])
    expect(() => v2EventSchema.safeParse(wire)).not.toThrow()
    expect(v2EventSchema.safeParse(wire).success).toBe(false)
  })

  it('rejects a plugin event the plugin schema refuses', () => {
    const schema = createV2EventSchema({ pluginBodies: [fixtureObservedSchema] })
    const [wire] = mintWire([{ type: 'fixture-observed', label: '' }])
    expect(schema.safeParse(wire).success).toBe(false)
  })

  it('folds the plugin view over decoded events', () => {
    const schema = createV2EventSchema({ pluginBodies: [fixtureObservedSchema] })
    const events = mintWire([observed, { type: 'user-said', text: 'x' }]).map(
      (wire): V2Event => schema.parse(wire),
    )
    const labels = events.reduce(fixtureLabelsView.fold, fixtureLabelsView.initial)
    expect(labels).toEqual(['first'])
  })
})

describe('composePlugins', () => {
  const second = definePlugin({
    name: 'second',
    events: [],
    views: [],
    commands: [{ name: 'second-command', summary: 'second' }],
    pod: { handlers: [] },
    control: { hooks: [] },
    client: { hooks: [] },
    transport: 'none',
  })

  it('carries every slot of every plugin', () => {
    const composed = composePlugins([fixturePlugin, second])
    expect(composed.names).toEqual(['fixture', 'second'])
    expect(composed.eventBodies).toHaveLength(1)
    expect(composed.views).toHaveLength(1)
    expect(composed.pod.handlers).toHaveLength(1)
    expect(composed.control.hooks).toHaveLength(1)
    expect(composed.client.hooks).toHaveLength(1)
    expect(composed.transports).toEqual(['stream', 'none'])
  })

  it('returns a frozen value', () => {
    const composed = composePlugins([fixturePlugin])
    expect(Object.isFrozen(composed)).toBe(true)
    expect(Object.isFrozen(composed.commands)).toBe(true)
    expect(Object.isFrozen(composed.pod)).toBe(true)
  })

  it('keeps commands in registration order', () => {
    const names = composePlugins([fixturePlugin, second]).commands.map((c) => c.name)
    expect(names).toEqual(['fixture-observe', 'second-command'])
    const reversed = composePlugins([second, fixturePlugin]).commands.map((c) => c.name)
    expect(reversed).toEqual(['second-command', 'fixture-observe'])
  })
})

describe('definePlugin', () => {
  it('freezes the plugin', () => {
    expect(Object.isFrozen(fixturePlugin)).toBe(true)
  })

  it('throws when a slot is missing', () => {
    const { client: _client, ...partial } = fixturePlugin
    expect(() => definePlugin({ ...partial } as Parameters<typeof definePlugin>[0])).toThrow(
      MissingPluginSlotError,
    )
  })
})
