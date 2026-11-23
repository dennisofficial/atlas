import { describe, expect, test } from 'bun:test'

import { EClientSurface } from '@dltech/atlas-core'

import { newClientId, presenceReporterOf, terminalPresenceStateOf } from '../presence'
import { fakeSessionClient } from './fake-session-client'

describe('terminal presence', () => {
  test('a session open reports the terminal watching it', () => {
    const client = fakeSessionClient({ onAuthLost: () => undefined })
    const reporter = presenceReporterOf({ api: client.api, clientId: 'client-1' })

    reporter.report(terminalPresenceStateOf({ sessionId: 'session-one' }))

    expect(client.calls.reportPresence).toHaveLength(1)
    expect(client.calls.reportPresence[0]).toMatchObject({
      clientId: 'client-1',
      surface: EClientSurface.Terminal,
      sessionId: 'session-one',
      foreground: true,
    })
  })

  test('leaving reports no session and no foreground', () => {
    const client = fakeSessionClient({ onAuthLost: () => undefined })
    const reporter = presenceReporterOf({ api: client.api, clientId: 'client-1' })

    reporter.report({ sessionId: null, foreground: false })

    expect(client.calls.reportPresence[0]).toMatchObject({
      clientId: 'client-1',
      surface: EClientSurface.Terminal,
      sessionId: null,
      foreground: false,
    })
  })

  test('two processes get different client ids', () => {
    expect(newClientId()).not.toBe(newClientId())
  })
})
