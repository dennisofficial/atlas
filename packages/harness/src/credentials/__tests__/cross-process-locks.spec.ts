import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { EAccountOrigin, EAuthKind, EAuthProvider } from '@dltech/atlas-core'

import { openArena, type Arena } from './cross-process'

let arena: Arena

beforeEach(() => {
  arena = openArena()
})

afterEach(async () => {
  await arena.close()
})

describe('the vault locks across real processes', () => {
  it('lets one process hold an account at a time', async () => {
    await arena.store.add({
      provider: EAuthProvider.OpenRouter,
      label: 'seed',
      secret: { kind: EAuthKind.ApiKey, apiKey: 'fake-key' },
      origin: EAccountOrigin.Login,
    })
    const names = ['a', 'b', 'c', 'd']
    const children = names.map((name) => arena.spawn({ mode: 'hold', name }))

    arena.open('go')
    await Promise.all(children.map((child) => child.finished))

    const events = arena.events()
    expect(events).toHaveLength(names.length * 2)
    events.forEach((event, index) => {
      const [who, phase] = event.split(' ')
      expect(phase).toBe(index % 2 === 0 ? 'start' : 'end')
      if (index % 2 === 1) expect(who).toBe(events[index - 1]?.split(' ')[0])
    })
  })

  it('keeps every account when processes write the vault at the same instant', async () => {
    await arena.store.add({
      provider: EAuthProvider.OpenRouter,
      label: 'seed',
      secret: { kind: EAuthKind.ApiKey, apiKey: 'fake-key' },
      origin: EAccountOrigin.Login,
    })
    const names = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']
    const children = names.map((name) => arena.spawn({ mode: 'add', name }))

    arena.open('go')
    await Promise.all(children.map((child) => child.finished))

    const labels = (await arena.store.list()).map((account) => account.label).sort()
    expect(labels).toEqual(['seed', ...names].sort())
  })
})
