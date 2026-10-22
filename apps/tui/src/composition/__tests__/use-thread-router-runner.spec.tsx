import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'vitest'
import React, { act } from 'react'

import { ERunner, toThreadId } from '@dltech/atlas-core'
import type { CloudBridge } from '@dltech/atlas-harness'

import { teardown } from '../../ui/markdown/__tests__/harness'
import { unstartedConversation } from '../open-conversation'
import { useThreadRouter, type ThreadRouter } from '../use-thread-router'
import { fakeApp, scriptedModelPort } from './fake-app'

const LOCAL_THREAD = toThreadId('brn_pod_thread')
const VERCEL_THREAD = toThreadId('brn_vercel_thread')
const row = (id: typeof LOCAL_THREAD, runner?: ERunner) => ({
  id,
  head: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  workspace: '/work',
  repo: null,
  ...(runner === undefined ? {} : { runner }),
})

const bridgeAnswering = (state: string): CloudBridge =>
  ({ sandboxes: { find: async () => ({ state }) } }) as unknown as CloudBridge

describe('the thread router across runners', () => {
  it('finds a sandbox on the bridge of the runner the thread was born on', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
    app.threads.seedThread(row(LOCAL_THREAD, ERunner.Local))
    app.threads.seedThread(row(VERCEL_THREAD))
    const asked: ERunner[] = []
    const probe: { router: ThreadRouter | null } = { router: null }

    function Probe(): React.ReactNode {
      probe.router = useThreadRouter({
        localApp: app,
        cloudBridge: null,
        cloudSession: null,
        createBridge: ({ runner }) => {
          asked.push(runner)
          return bridgeAnswering(runner)
        },
        containerMove: {} as never,
        working: false,
        activeThreadId: 'other',
        opened: unstartedConversation({ ids: app.ids }),
        onReload: async () => undefined,
        onLeaveCloud: () => undefined,
        onLocalSwap: () => undefined,
      })
      return null
    }

    let setup!: Awaited<ReturnType<typeof testRender>>
    await act(async () => {
      setup = await testRender(<Probe />, { width: 10, height: 3 })
    })
    try {
      await act(async () => {
        await setup.renderOnce()
      })
      const sandbox = probe.router?.findSandbox()

      expect(await sandbox?.find({ threadId: LOCAL_THREAD })).toEqual({
        state: ERunner.Local,
      } as never)
      expect(await sandbox?.find({ threadId: VERCEL_THREAD })).toEqual({
        state: ERunner.Vercel,
      } as never)
      expect(asked).toEqual([ERunner.Local, ERunner.Vercel])
    } finally {
      await teardown(setup)
    }
  })
})
