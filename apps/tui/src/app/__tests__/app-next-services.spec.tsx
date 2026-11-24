import { describe, expect, test } from 'bun:test'
import { act } from 'react'

import { mintEvents } from '@dltech/atlas-client/stream-fixture'

import { frameShowing } from '../../ui/__tests__/waiting'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { openSession, SESSION_ID, WITHIN, type Mounted } from './app-next-harness'

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

const mountedWithService = async (
  configure?: (client: NonNullable<ReturnType<Mounted['client']>>) => void,
): Promise<Mounted> => {
  const mounted = await openSession({ ...(configure === undefined ? {} : { configure }) })
  mounted.client()?.pushEvents({ sessionId: SESSION_ID, events: SERVICE_STARTED, live: true })
  await frameShowing({ setup: mounted.setup, text: 'preview.example.test', within: WITHIN })
  return mounted
}

const openDrawer = async (mounted: Mounted): Promise<string> => {
  const rows = mounted.setup.captureCharFrame().split('\n')
  const line = rows.findIndex((row) => row.includes('preview.example.test'))
  const column = rows[line]?.indexOf('preview.example.test') ?? -1
  if (line < 0 || column < 0) throw new Error('the service row is not drawn')

  await act(async () => {
    await mounted.setup.mockMouse.click(column + 2, line)
  })
  await mounted.setup.flush()
  return mounted.setup.captureCharFrame()
}

describe('the services pane', () => {
  test('the sidebar lists a running service with its preview url', async () => {
    const mounted = await mountedWithService()

    try {
      const frame = mounted.setup.captureCharFrame()
      expect(frame).toContain('web')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('the drawer reads the service log', async () => {
    const mounted = await mountedWithService((client) =>
      client.pushServiceLog({ text: 'listening on :3000', truncated: false }),
    )

    try {
      const frame = await openDrawer(mounted)
      expect(frame).toContain('listening on :3000')
      expect(frame).toContain('stop')
      expect(mounted.client()?.calls.servicesLog).toEqual([
        { sessionId: SESSION_ID, serviceId: 'svc-1' },
      ])
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('s stops and r restarts the open service', async () => {
    const mounted = await mountedWithService()

    try {
      await openDrawer(mounted)

      mounted.setup.mockInput.pressKey('r')
      mounted.setup.mockInput.pressKey('s')
      const frame = mounted.setup.captureCharFrame()

      expect(frame).toContain('SERVICE LOG')
      expect(mounted.client()?.calls.runCommand).toEqual([
        { sessionId: SESSION_ID, name: 'service', args: { action: 'restart', serviceId: 'svc-1' } },
        { sessionId: SESSION_ID, name: 'service', args: { action: 'stop', serviceId: 'svc-1' } },
      ])
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)

  test('a 503 says the pod is asleep and draws no error', async () => {
    const mounted = await mountedWithService((client) => client.refuseServiceLog(503))

    try {
      const frame = await openDrawer(mounted)
      expect(frame).toContain('The pod is asleep.')
      expect(frame).not.toContain('The log is unavailable.')
    } finally {
      await teardown(mounted.setup)
    }
  }, 60_000)
})
