import { describe, expect, test } from 'bun:test'

import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { frameShowing } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN } from './app-next-harness'

const SERVICE_STARTED = mintEvents({
  bodies: [
    { type: 'user-said', text: 'start the web server' },
    {
      type: 'service-started',
      serviceId: 'svc-1',
      command: 'bun dev',
      name: 'web',
      port: 3000,
      url: 'https://preview.example.test',
    },
  ],
})

describe('the services pane', () => {
  test('the sidebar lists a running service with its preview url', async () => {
    const mounted = await openSession()

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: SERVICE_STARTED, live: true })

      const frame = await frameShowing({
        setup: mounted.setup,
        text: 'preview.example.test',
        within: WITHIN,
      })
      expect(frame).toContain('web')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('the write keys record nothing, because v2 has no service route yet', async () => {
    const mounted = await openSession()

    try {
      mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: SERVICE_STARTED, live: true })
      await frameShowing({ setup: mounted.setup, text: 'preview.example.test', within: WITHIN })

      mounted.setup.mockInput.pressKey('s')
      mounted.setup.mockInput.pressKey('r')
      mounted.setup.mockInput.pressKey('k')

      const calls = mounted.client()?.calls
      expect(calls?.runCommand).toEqual([])
      expect(calls?.wakePod).toEqual([])
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
