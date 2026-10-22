import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { authorityOf, EAuthKind } from '@dltech/atlas-core'

import { openArena, seedExpiredGrant, type Arena } from './cross-process'

let arena: Arena

beforeEach(() => {
  arena = openArena()
})

afterEach(async () => {
  await arena.close()
})

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms))

describe('a local refresh and a cloud handoff in different processes', () => {
  it('uploads the rotated refresh token when the local refresh holds the lock first', async () => {
    const account = await seedExpiredGrant(arena)
    const refresher = arena.spawn({ mode: 'refresh', name: 'refresher', signal: 'redeeming', blockOn: 'finish-redeem' })
    await arena.reached('redeeming')

    const handoff = arena.spawn({ mode: 'handoff', name: 'handoff' })
    await settle(400)
    expect(arena.events().some((event) => event.startsWith('handoff upload-start'))).toBe(false)
    expect((await arena.store.read(account.id))?.secret.kind).toBe(EAuthKind.Oauth)

    arena.open('finish-redeem')
    await Promise.all([refresher.finished, handoff.finished])

    expect(arena.events()).toEqual([
      'refresher redeem-start fake-seed-refresh',
      'refresher redeem-end',
      'refresher read-ok',
      'handoff upload-start fake-rotated-refresh',
      'handoff upload-end',
      'handoff read-ok',
    ])
  })

  it('never redeems the seed once the handoff has persisted its marker', async () => {
    const account = await seedExpiredGrant(arena)
    const handoff = arena.spawn({ mode: 'handoff', name: 'handoff', signal: 'uploading', blockOn: 'finish-upload' })
    await arena.reached('uploading')

    const pending = (await arena.store.read(account.id))?.secret
    expect(pending && authorityOf(pending)?.connectionId).toBe('oauth_cross')
    expect(pending?.kind === EAuthKind.Oauth && pending.tokens.refreshToken).toBe('fake-seed-refresh')

    const refresher = arena.spawn({ mode: 'refresh', name: 'refresher' })
    await refresher.finished
    expect(arena.events().some((event) => event.startsWith('refresher redeem'))).toBe(false)
    expect(arena.events()).toContain('refresher read-refused')

    arena.open('finish-upload')
    await handoff.finished

    const settled = (await arena.store.read(account.id))?.secret
    expect(settled?.kind === EAuthKind.Oauth && settled.tokens.refreshToken).toBe('')
    expect(settled && authorityOf(settled)?.connectionId).toBe('oauth_cross')
  })
})
