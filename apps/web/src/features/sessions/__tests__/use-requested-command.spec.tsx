import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'
import type { Root } from 'react-dom/client'

import type { SessionSnapshot } from '@dltech/atlas-client/stream'
import {
  ECompactionAnchor,
  ESessionStatus,
  toEventId,
  toRunId,
  toThreadId,
  type Hash,
  type RecordEvent,
} from '@dltech/atlas-core'

import { type RequestedCommandState, useRequestedCommand } from '../data/use-requested-command'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

afterEach(() => {
  document.body.innerHTML = ''
})

const INBOX = 105
const AT = '2026-11-28T10:00:02.000Z'

const IDLE: SessionSnapshot['status'] = {
  state: ESessionStatus.Idle,
  lease: { epoch: 1, holderHostId: 1, live: true },
}

const SUMMARISED: RecordEvent = {
  id: toEventId('t:20'),
  seq: 20,
  threadId: toThreadId('t'),
  runId: toRunId('r'),
  depth: 0,
  at: AT,
  epoch: 1,
  prevHash: 'a'.repeat(64) as Hash,
  type: 'history-summarised',
  fromSeq: 1,
  throughSeq: 4,
  anchor: ECompactionAnchor.Prefix,
  summary: 's',
  inboxId: INBOX,
}

let latest: RequestedCommandState | undefined

function Probe({ events }: { events: readonly RecordEvent[] }) {
  latest = useRequestedCommand({ status: IDLE, events })
  return null
}

const deferred = () => {
  let resolve: (inboxId: number) => void = () => undefined
  let reject: (failure: Error) => void = () => undefined
  const promise = new Promise<number>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

const mount = async (): Promise<Root> => {
  const { createRoot } = await import('react-dom/client')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<Probe events={[]} />))
  return root
}

describe('useRequestedCommand', () => {
  it('blocks the moment a summarise is requested and clears once it is summarised', async () => {
    const root = await mount()
    const request = deferred()
    let tracked: Promise<void> | undefined
    await act(async () => {
      tracked = latest?.track({ name: 'summarise', request: () => request.promise })
    })
    expect(latest?.blocking?.copy.label).toBe('Summarising history')

    await act(async () => {
      request.resolve(INBOX)
      await tracked
    })
    expect(latest?.blocking?.inboxId).toBe(INBOX)

    await act(async () => root.render(<Probe events={[SUMMARISED]} />))
    expect(latest?.blocking).toBeUndefined()
    root.unmount()
  })

  it('clears when the request fails', async () => {
    const root = await mount()
    const request = deferred()
    let failed = false
    await act(async () => {
      const tracked = latest?.track({ name: 'summarise', request: () => request.promise })
      request.reject(new Error('down'))
      await tracked?.catch(() => {
        failed = true
      })
    })
    expect(failed).toBe(true)
    expect(latest?.blocking).toBeUndefined()
    root.unmount()
  })
})
