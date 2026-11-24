import { describe, expect, it } from 'bun:test'

import type { CommandHandler } from '@dltech/atlas-commands'

import { composePodCommands, composePod } from '../compose-pod'
import { EMPTY_POD } from '../slots'
import type { PluginPodContext, PodCommandFactory, PodSlash, PodSlot } from '../slots'

const ctx = {} as PluginPodContext

const podCtx = { sessionId: 's-1' } as PluginPodContext

const slashOf = (name: string): PodSlash => ({
  names: async () => [name],
  load: async () => ({ ok: false, reason: `no skill is named ${name}` }),
})

const podWith = (slash: PodSlot['slash']): PodSlot => ({
  ...EMPTY_POD,
  ...(slash === undefined ? {} : { slash }),
})

const handler: CommandHandler<unknown> = async () => ({ kind: 'done' })

const factoryOf =
  (key: string): PodCommandFactory =>
  (podContext) =>
    new Map([[`${key}:${podContext.sessionId}`, handler]])

const podWithCommands = (key: string): PodSlot => ({
  ...EMPTY_POD,
  commands: factoryOf(key),
})

describe('composePod slash', () => {
  it('exposes the one slash source a plugin contributes', () => {
    const slash = slashOf('review')
    const composed = composePod([EMPTY_POD, podWith(() => slash)])
    expect(composed.slash(ctx)).toBe(slash)
  })

  it('exposes no slash source when no plugin contributes one', () => {
    expect(composePod([EMPTY_POD]).slash(ctx)).toBeUndefined()
  })

  it('throws when two plugins register a slash source', () => {
    expect(() => composePod([podWith(() => slashOf('a')), podWith(() => slashOf('b'))])).toThrow(
      'two plugins register a slash source',
    )
  })
})

describe('composePod commands', () => {
  it('builds the command map from the pod context', () => {
    const composed = composePod([podWithCommands('agent')])
    expect([...composed.commands(podCtx).keys()]).toEqual(['agent:s-1'])
    expect(composed.commands(podCtx).get('agent:s-1')).toBe(handler)
  })

  it('builds an empty map when no plugin contributes a command', () => {
    expect(composePod([EMPTY_POD]).commands(podCtx).size).toBe(0)
  })

  it('merges the maps of every plugin', () => {
    const composed = composePod([podWithCommands('agent'), podWithCommands('shell-kill')])
    expect([...composed.commands(podCtx).keys()]).toEqual(['agent:s-1', 'shell-kill:s-1'])
  })

  it('throws when two plugins register one command', () => {
    const composed = composePod([podWithCommands('agent'), podWithCommands('agent')])
    expect(() => composed.commands(podCtx)).toThrow(
      'two plugins register the pod command "agent:s-1"',
    )
  })
})

describe('composePodCommands', () => {
  it('walks the factories in order', () => {
    const merged = composePodCommands({
      factories: [factoryOf('agent'), factoryOf('shell-kill')],
      ctx: podCtx,
    })
    expect([...merged.keys()]).toEqual(['agent:s-1', 'shell-kill:s-1'])
  })

  it('builds nothing without a context', () => {
    expect(composePodCommands({ factories: [factoryOf('agent')] }).size).toBe(0)
  })

  it('throws when two factories register one command', () => {
    expect(() =>
      composePodCommands({ factories: [factoryOf('agent'), factoryOf('agent')], ctx: podCtx }),
    ).toThrow('two plugins register the pod command "agent:s-1"')
  })
})
