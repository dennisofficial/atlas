import { describe, expect, it } from 'bun:test'
import { testRender } from '@opentui/react/test-utils'
import React, { useEffect } from 'react'

import { EServiceStatus } from '@dltech/atlas-core'
import type { ServiceSnapshot } from '@dltech/atlas-harness'

import { settle, teardown } from '../../ui/markdown/__tests__/harness'
import { useServices, type ServicesControl } from '../use-services'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

const POLL_MS = 500

const service = ({
  serviceId,
  status,
}: {
  serviceId: string
  status: EServiceStatus
}): ServiceSnapshot => ({
  serviceId,
  command: 'bun run dev',
  description: 'dev server',
  status,
  ...(status === EServiceStatus.Running ? {} : { exitCode: 0 }),
  logPath: `/nowhere/on/this/machine/${serviceId}.log`,
  startedAt: '2026-10-28T12:00:00.000Z',
})

const Probe = ({ app, seen }: { app: FakeApp; seen: ServicesControl[] }): React.ReactNode => {
  const control = useServices({ app })
  useEffect(() => {
    seen.push(control)
  })
  return null
}

const mounted = async ({
  services,
  logTail,
}: {
  services: readonly ServiceSnapshot[]
  logTail: NonNullable<FakeApp['services']['logTail']>
}) => {
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
  for (const one of services) app.services.place(one)
  app.services.logTail = logTail
  const seen: ServicesControl[] = []
  const setup = await testRender(<Probe app={app} seen={seen} />, { width: 10, height: 2 })
  await setup.flush()
  const settled = async (ms: number): Promise<void> => {
    await settle(ms)
    await setup.flush()
  }
  return { setup, seen, settled }
}

describe('the services drawer’s log tail', () => {
  it('tails a running service’s log through the port on the poll cadence, committing nothing while it is quiet', async () => {
    let tail = 'booting\n'
    const asked: { serviceId: string; characters: number }[] = []
    const { setup, seen, settled } = await mounted({
      services: [service({ serviceId: 'svc_1', status: EServiceStatus.Running })],
      logTail: async (args) => {
        asked.push(args)
        return tail
      },
    })

    try {
      seen.at(-1)?.handleOpen('svc_1')
      await settled(60)

      expect(seen.at(-1)?.log).toBe('booting\n')
      expect(asked[0]?.serviceId).toBe('svc_1')

      tail = 'booting\nlistening on :3000\n'
      await settled(POLL_MS + 60)

      expect(seen.at(-1)?.log).toBe('booting\nlistening on :3000\n')

      const renders = seen.length
      const polls = asked.length
      await settled(POLL_MS * 2 + 60)

      expect(asked.length).toBeGreaterThan(polls)
      const quiet = seen.slice(renders - 1)
      const notFromTheClock = quiet.slice(1).filter((control, at) => control.now === quiet[at]?.now)
      expect(notFromTheClock).toEqual([])
      expect(new Set(quiet.map((control) => control.log))).toEqual(
        new Set(['booting\nlistening on :3000\n']),
      )
    } finally {
      await teardown(setup)
    }
  }, 20_000)

  it('reads an ended service’s final log once instead of polling it — a poll would wake a parked pod', async () => {
    let reads = 0
    const { setup, seen, settled } = await mounted({
      services: [service({ serviceId: 'svc_1', status: EServiceStatus.Exited })],
      logTail: async () => {
        reads += 1
        return 'bye\n'
      },
    })

    try {
      seen.at(-1)?.handleOpen('svc_1')
      await settled(POLL_MS * 2 + 60)

      expect(seen.at(-1)?.log).toBe('bye\n')
      expect(reads).toBe(1)
    } finally {
      await teardown(setup)
    }
  }, 20_000)

  it('never stacks a second read on one still in flight', async () => {
    let reads = 0
    const { setup, seen, settled } = await mounted({
      services: [service({ serviceId: 'svc_1', status: EServiceStatus.Running })],
      logTail: () => {
        reads += 1
        return new Promise<string>(() => undefined)
      },
    })

    try {
      seen.at(-1)?.handleOpen('svc_1')
      await settled(POLL_MS * 3 + 60)

      expect(reads).toBe(1)
    } finally {
      await teardown(setup)
    }
  }, 20_000)

  it('drops a late reply for a service the drawer has moved off', async () => {
    const late: { resolve: (text: string) => void }[] = []
    const { setup, seen, settled } = await mounted({
      services: [
        service({ serviceId: 'svc_1', status: EServiceStatus.Exited }),
        service({ serviceId: 'svc_2', status: EServiceStatus.Exited }),
      ],
      logTail: ({ serviceId }) =>
        serviceId === 'svc_1'
          ? new Promise<string>((resolve) => late.push({ resolve }))
          : Promise.resolve('svc_2 log\n'),
    })

    try {
      seen.at(-1)?.handleOpen('svc_1')
      await settled(60)
      seen.at(-1)?.handleSelect('svc_2')
      await settled(60)
      expect(seen.at(-1)?.log).toBe('svc_2 log\n')

      late[0]?.resolve('svc_1 log\n')
      await settled(60)

      expect(seen.at(-1)?.log).toBe('svc_2 log\n')
    } finally {
      await teardown(setup)
    }
  }, 20_000)
})
