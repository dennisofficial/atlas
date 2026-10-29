import { describe, expect, it } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import React, { useEffect } from 'react'

import { EServiceStatus } from '@dltech/atlas-core'
import type { ServiceSnapshot } from '@dltech/atlas-harness'

import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { useServices, type ServicesControl } from '../use-services'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const POLL_MS = 500

const exited: ServiceSnapshot = {
  serviceId: 'svc_1',
  command: 'bun run dev',
  description: 'dev server',
  status: EServiceStatus.Exited,
  exitCode: 0,
  logPath: '/nowhere/on/this/machine/svc_1.log',
  startedAt: '2026-10-28T12:00:00.000Z',
}

const Probe = ({ app, seen }: { app: FakeApp; seen: ServicesControl[] }): React.ReactNode => {
  const control = useServices({ app })
  useEffect(() => {
    seen.push(control)
  })
  return null
}

describe('the services drawer’s log tail', () => {
  it('tails the selected service’s log through the port on the poll cadence', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
    app.services.place(exited)
    let tail = 'booting\n'
    const asked: { serviceId: string; characters: number }[] = []
    app.services.logTail = async (args) => {
      asked.push(args)
      return tail
    }

    const seen: ServicesControl[] = []
    const setup = await testRender(<Probe app={app} seen={seen} />, { width: 10, height: 2 })

    try {
      await setup.flush()
      seen.at(-1)?.handleOpen('svc_1')
      await settle(60)
      await setup.flush()

      expect(seen.at(-1)?.log).toBe('booting\n')
      expect(asked[0]?.serviceId).toBe('svc_1')

      tail = 'booting\nlistening on :3000\n'
      await settle(POLL_MS + 60)
      await setup.flush()

      expect(seen.at(-1)?.log).toBe('booting\nlistening on :3000\n')

      const renders = seen.length
      const polls = asked.length
      await settle(POLL_MS * 2 + 60)
      await setup.flush()

      expect(asked.length).toBeGreaterThan(polls)
      expect(seen.length).toBe(renders)
    } finally {
      await teardown(setup)
    }
  }, 20_000)
})
