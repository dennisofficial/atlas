import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import type { QuickStopEvidence } from '@dltech/atlas-client/session'

import { stageMessage } from '../staged-store'
import { useQuickStopRestore } from '../use-quick-stop-restore'

beforeAll(() => {
  registerDom()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await unregisterDom()
})

const evidenceOf = (rewindEventId: string, clientId: string): readonly QuickStopEvidence[] => [
  { rewindEventId, messages: [{ clientId, text: 'hello', attachments: [] }] },
]

const mount = async (args: { sessionId: string; quickStops: readonly QuickStopEvidence[] }) => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  const root = createRoot(host)
  const restores: string[] = []
  function Probe() {
    useQuickStopRestore({
      sessionId: args.sessionId,
      quickStops: args.quickStops,
      onRestore: (restored) => restores.push(restored.text),
    })
    return null
  }
  await act(async () => root.render(<Probe />))
  return {
    restores,
    unmount: async () => act(async () => root.unmount()),
  }
}

describe('useQuickStopRestore', () => {
  it('puts the quick-stopped message back once', async () => {
    stageMessage({
      sessionId: 'ses-quick-stop',
      message: { clientId: 'client-a', text: 'hello', attachments: [] },
    })
    const view = await mount({
      sessionId: 'ses-quick-stop',
      quickStops: evidenceOf('evt-1', 'client-a'),
    })

    expect(view.restores).toEqual(['hello'])
    await view.unmount()
  })

  it('does not restore again after the hook remounts', async () => {
    stageMessage({
      sessionId: 'ses-quick-stop-remount',
      message: { clientId: 'client-b', text: 'hello', attachments: [] },
    })
    const quickStops = evidenceOf('evt-2', 'client-b')
    const first = await mount({ sessionId: 'ses-quick-stop-remount', quickStops })
    expect(first.restores).toEqual(['hello'])
    await first.unmount()

    const second = await mount({ sessionId: 'ses-quick-stop-remount', quickStops })

    expect(second.restores).toEqual([])
    await second.unmount()
  })

  it('leaves a message this client did not send alone', async () => {
    stageMessage({
      sessionId: 'ses-quick-stop-other',
      message: { clientId: 'client-c', text: 'hello', attachments: [] },
    })
    const view = await mount({
      sessionId: 'ses-quick-stop-other',
      quickStops: evidenceOf('evt-3', 'client-z'),
    })

    expect(view.restores).toEqual([])
    await view.unmount()
  })
})
