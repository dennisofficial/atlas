import { describe, expect, test } from 'bun:test'

import { createFakeTransport } from '@dltech/atlas-client/stream-fixture'

import { authWatchingTransport } from '../auth-transport'
import type { AuthRefusal } from '../session-client'

const NO_FRAME = (): void => undefined

const watchedOf = () => {
  const fake = createFakeTransport()
  const lost: AuthRefusal[] = []
  const watched = authWatchingTransport({
    transport: fake.transport,
    onAuthLost: (status) => lost.push(status),
  })

  return { fake, lost, watched }
}

const handlerInto = (seen: (number | undefined)[]) => ({
  handleFrame: NO_FRAME,
  handleEnd: NO_FRAME,
  handleFailure: (status: number | undefined) => seen.push(status),
})

describe('authWatchingTransport', () => {
  test('a 401 from follow reaches onAuthLost and the caller', () => {
    const { fake, lost, watched } = watchedOf()
    const seen: (number | undefined)[] = []

    watched.follow({ sessionId: 'session-1' }, handlerInto(seen))
    fake.follows[0]?.handlers.handleFailure(401)

    expect(lost).toEqual([401])
    expect(seen).toEqual([401])
  })

  test('a 403 from list reaches onAuthLost and the caller', () => {
    const { fake, lost, watched } = watchedOf()
    const seen: (number | undefined)[] = []

    watched.list(handlerInto(seen))
    fake.lists[0]?.handlers.handleFailure(403)

    expect(lost).toEqual([403])
    expect(seen).toEqual([403])
  })

  test('a 500 reaches only the caller', () => {
    const { fake, lost, watched } = watchedOf()
    const seen: (number | undefined)[] = []

    watched.list(handlerInto(seen))
    fake.lists[0]?.handlers.handleFailure(500)

    expect(lost).toEqual([])
    expect(seen).toEqual([500])
  })
})
