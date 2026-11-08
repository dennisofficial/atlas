import { describe, expect, it } from 'bun:test'
import {
  chainEvents,
  createV2EventSchema,
  toRunId,
  toThreadId,
  v2EventSchema,
} from '@dltech/atlas-core'
import type { V2Body, V2Event } from '@dltech/atlas-core'

import {
  composePlugins,
  definePlugin,
  EMPTY_CONTROL,
  EMPTY_POD,
  eventSchemaOf,
  eventTypesOf,
  MissingPluginSlotError,
} from '..'
import type { Plugin, PluginPodContext, PodSlot } from '..'
import {
  createFixturePlugin,
  fixturePlugin,
  PROBE_FRAGMENT_ID,
  probeLabelsView,
  probeObservedSchema,
} from '../testing'

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

const observed: V2Body = { type: 'probe-observed', label: 'first' }

describe('plugin event registry', () => {
  it('round-trips a plugin event through the composed decoder', () => {
    const composed = composePlugins([fixturePlugin])
    const schema = createV2EventSchema({ pluginBodies: composed.eventBodies })
    const [wire] = mintWire([observed])
    const parsed = schema.safeParse(wire)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({ type: 'probe-observed', label: 'first', seq: 1 })
  })

  it('still decodes core and record bodies through the composed decoder', () => {
    const schema = createV2EventSchema({ pluginBodies: [probeObservedSchema] })
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
    const schema = createV2EventSchema({ pluginBodies: [probeObservedSchema] })
    const [wire] = mintWire([{ type: 'probe-observed', label: '' }])
    expect(schema.safeParse(wire).success).toBe(false)
  })

  it('folds the plugin view over decoded events', () => {
    const schema = createV2EventSchema({ pluginBodies: [probeObservedSchema] })
    const events = mintWire([observed, { type: 'user-said', text: 'x' }]).map(
      (wire): V2Event => schema.parse(wire),
    )
    const labels = events.reduce(probeLabelsView.fold, probeLabelsView.initial)
    expect(labels).toEqual(['first'])
  })
})

describe('eventTypesOf', () => {
  it('names every body type a composed decoder reads', () => {
    const types = eventTypesOf([fixturePlugin])
    expect(types).toContain('user-said')
    expect(types).toContain('history-rewound')
    expect(types).toContain('probe-observed')
    expect([...types]).toEqual([...types].sort())
  })

  it('drops the plugin types when no plugin registers one', () => {
    expect(eventTypesOf([])).not.toContain('probe-observed')
    expect(eventTypesOf([])).toContain('user-said')
  })

  it('agrees with the decoder it belongs to', () => {
    const schema = eventSchemaOf([fixturePlugin])
    for (const wire of mintWire([observed, { type: 'user-said', text: 'x' }])) {
      const parsed = schema.safeParse(wire)
      expect(parsed.success).toBe(true)
    }
  })
})

describe('composePlugins', () => {
  const second = definePlugin({
    name: 'second',
    events: [],
    views: [],
    commands: [],
    pod: EMPTY_POD,
    control: EMPTY_CONTROL,
    client: { hooks: [] },
    transport: 'none',
  })

  it('carries every slot of every plugin', () => {
    const composed = composePlugins([fixturePlugin, second])
    expect(composed.names).toEqual(['probe', 'second'])
    expect(composed.eventBodies).toHaveLength(1)
    expect(composed.views).toHaveLength(1)
    expect(composed.commands.map((c) => c.spec.name)).toEqual(['probe-observe', 'probe-read'])
    expect(composed.pod.prompts.map((p) => p.id)).toEqual([PROBE_FRAGMENT_ID])
    expect([...composed.pod.commands.keys()]).toEqual(['command:probe-observe'])
    expect([...composed.control.commands.keys()]).toEqual(['probe-read'])
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

  it('composes nothing from an empty list', () => {
    const composed = composePlugins([])
    expect(composed.pod.prompts).toEqual([])
    expect(composed.pod.commands.size).toBe(0)
    expect(composed.control.commands.size).toBe(0)
  })

  const isolated = (args: { name: string; pod: PodSlot }) =>
    definePlugin({
      name: args.name,
      events: [],
      views: [],
      commands: [],
      pod: args.pod,
      control: EMPTY_CONTROL,
      client: { hooks: [] },
      transport: 'none',
    })

  const podOf = (plugin: Plugin, overrides: Partial<PodSlot>): PodSlot => ({
    ...plugin.pod,
    prompts: [],
    commands: new Map(),
    ...overrides,
  })

  it('refuses two plugins that register the same prompt id', () => {
    const twin = createFixturePlugin().plugin
    const a = isolated({ name: 'a', pod: { ...EMPTY_POD, prompts: fixturePlugin.pod.prompts } })
    const b = isolated({ name: 'b', pod: { ...EMPTY_POD, prompts: twin.pod.prompts } })
    expect(() => composePlugins([a, b])).toThrow(
      'two plugins register the prompt fragment "probe-fragment"',
    )
  })

  it('refuses two plugins that register the same control command', () => {
    const twin = createFixturePlugin().plugin
    const control = (name: string, plugin: Plugin) =>
      definePlugin({ ...plugin, name, pod: EMPTY_POD })
    expect(() => composePlugins([control('a', fixturePlugin), control('b', twin)])).toThrow(
      'two plugins register the control command "probe-read"',
    )
  })

  it('refuses two tools with one name', () => {
    const a = createFixturePlugin().plugin
    const b = createFixturePlugin().plugin
    const composed = composePlugins([
      isolated({ name: 'a', pod: podOf(a, {}) }),
      isolated({ name: 'b', pod: podOf(b, {}) }),
    ])
    const ctx = { onDaemonEvent: () => () => {} } as unknown as PluginPodContext
    expect(() => composed.pod.tools(ctx)).toThrow('two plugins register the tool "probe_tool"')
  })

  it('refuses two pod commands with one name', () => {
    const a = createFixturePlugin().plugin
    const b = createFixturePlugin().plugin
    const only = (name: string, plugin: Plugin) =>
      isolated({ name, pod: { ...EMPTY_POD, commands: plugin.pod.commands } })
    expect(() => composePlugins([only('a', a), only('b', b)])).toThrow(
      'two plugins register the pod command "command:probe-observe"',
    )
  })

  it('fans a daemon frame out to every slot handler', () => {
    const { plugin, record } = createFixturePlugin()
    const frame = { kind: 'event', event: { type: 'git.branches' } } as never
    composePlugins([plugin, second]).pod.onDaemonEvent(frame)
    expect(record.daemonFrames).toEqual([frame])
  })

  it('concatenates hook arrays', () => {
    const a = createFixturePlugin().plugin
    const b = createFixturePlugin().plugin
    const ctx = { onDaemonEvent: () => () => {} } as unknown as PluginPodContext
    const hooks = composePlugins([
      isolated({ name: 'a', pod: podOf(a, {}) }),
      isolated({ name: 'b', pod: podOf(b, {}) }),
    ]).pod.hooks(ctx)
    expect(hooks.beforeStep).toHaveLength(2)
    expect(hooks.afterTurn).toEqual([])
  })

  it('keeps commands in registration order', () => {
    const names = composePlugins([fixturePlugin, second]).commands.map((c) => c.spec.name)
    expect(names).toEqual(['probe-observe', 'probe-read'])
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
