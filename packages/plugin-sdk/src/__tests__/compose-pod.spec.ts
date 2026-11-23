import { describe, expect, it } from 'bun:test'

import { EMPTY_POD } from '../slots'
import type { PluginPodContext, PodSlash, PodSlot } from '../slots'
import { composePod } from '../compose-pod'

const ctx = {} as PluginPodContext

const slashOf = (name: string): PodSlash => ({
  names: async () => [name],
  load: async () => ({ ok: false, reason: `no skill is named ${name}` }),
})

const podWith = (slash: PodSlot['slash']): PodSlot => ({
  ...EMPTY_POD,
  ...(slash === undefined ? {} : { slash }),
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
