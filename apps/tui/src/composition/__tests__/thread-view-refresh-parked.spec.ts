import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { EChannelConnection, RemoteTurnRunner, type ChannelConnection } from '@dltech/atlas-harness'

import type { ConversationStore } from '../../store'
import type { AtlasApp } from '../compose'
import { createThreadViewRefresh } from '../thread-view-refresh'
import { EThreadRows } from '../use-thread-view'

const THREAD = toThreadId('refresh-stands-down')

const cloudAppFor = (connection: ChannelConnection): AtlasApp =>
  ({
    runner: Object.create(RemoteTurnRunner.prototype) as RemoteTurnRunner,
    channel: { connection: () => connection },
  }) as unknown as AtlasApp

const refreshOf = (connection: ChannelConnection) =>
  createThreadViewRefresh({
    app: cloudAppFor(connection),
    threadId: THREAD,
    rows: EThreadRows.Composed,
    effects: () => undefined,
    store: {} as ConversationStore,
    setEvents: () => undefined,
    heldEvents: () => [],
    readSeed: undefined,
  })

describe('a refresh of a parked cloud thread', () => {
  it('stands refresh down so signals stop reaching for a transcript nobody can answer', () => {
    const refresh = refreshOf({ state: EChannelConnection.Parked, detail: 'idle' })
    expect(refresh.refreshable()).toBe(false)
  })

  it('refreshes while the thread is open on the serve', () => {
    const refresh = refreshOf({ state: EChannelConnection.Open, detail: null })
    expect(refresh.refreshable()).toBe(true)
  })

  it('refreshes while the sandbox is waking, since the read lands once it re-attaches', () => {
    const refresh = refreshOf({ state: EChannelConnection.Waking, detail: null })
    expect(refresh.refreshable()).toBe(true)
  })
})
