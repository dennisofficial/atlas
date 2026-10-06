import { describe, expect, it } from 'bun:test'
import React, { act } from 'react'
import { testRender } from '@opentui/react/test-utils'

import type { StepFailure } from '../../store'
import { frameShowing, frameWhen } from '../../ui/__tests__/waiting'
import { grammarsReady, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { useFailureNotice } from '../use-failure-notice'
import { spokenIn, THREAD } from './app-fixture'
import { fakeApp, failingModelPort, scriptedModelPort } from './fake-app'

await grammarsReady()

describe('dismissing a transient failure', () => {
  it('clears a command notice without changing history or the draft, and allows a later notice', async () => {
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'done' } }) })
    const opened = await spokenIn(app)
    const setup = await testRender(<App app={app} opened={opened} />, { width: 100, height: 35 })
    try {
      await frameShowing({ setup, text: 'what is in here?' })
      const history = await app.log.read({ threadId: THREAD })
      await setup.mockInput.typeText('/compact sideways')
      setup.mockInput.pressEnter()
      const frame = await frameShowing({ setup, text: 'not sideways' })
      await setup.mockInput.typeText('keep this draft')
      await frameShowing({ setup, text: 'keep this draft' })
      const rows = frame.split('\n')
      const y = rows.findIndex((row) => row.includes('failed'))
      const x = rows[y]?.indexOf('[close]') ?? -1
      expect(x).toBeGreaterThan(0)
      await setup.mockMouse.click(x, y)
      const dismissed = await frameWhen({
        setup,
        holds: (drawn) => !drawn.includes('not sideways'),
        describe: 'the command error to be dismissed',
      })
      expect(dismissed).toContain('what is in here?')
      expect(dismissed).toContain('keep this draft')
      expect(await app.log.read({ threadId: THREAD })).toEqual(history)

      setup.mockInput.pressKey('a', { ctrl: true })
      setup.mockInput.pressBackspace()
      await setup.mockInput.typeText('/compact sideways')
      setup.mockInput.pressEnter()
      expect(await frameShowing({ setup, text: 'not sideways' })).toContain('[close]')
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('keeps an actual failed-turn reason and its retry control without offering close', async () => {
    const reason = 'the turn failed before producing a reply'
    const app = fakeApp({ model: failingModelPort({ message: reason }) })
    const opened = await spokenIn(app)
    const setup = await testRender(<App app={app} opened={opened} />, { width: 100, height: 35 })
    try {
      await frameShowing({ setup, text: 'what is in here?' })
      await setup.mockInput.typeText('continue the work')
      setup.mockInput.pressEnter()
      const frame = await frameShowing({ setup, text: 'ctrl+r retry' })
      expect(frame).toContain(reason)
      expect(frame).not.toContain('[close]')
      expect(frame).not.toContain('The model reported no reason.')
    } finally {
      await teardown(setup)
    }
  }, 30_000)

  it('keeps a turn-outcome reason protected even without a failed step projection', async () => {
    let notice: ReturnType<typeof useFailureNotice> | null = null
    function Probe(): React.ReactNode {
      notice = useFailureNotice()
      return <text>{notice.failure ?? 'no notice'}</text>
    }
    const setup = await testRender(<Probe />, { width: 60, height: 5 })
    try {
      await frameShowing({ setup, text: 'no notice' })
      const readNotice = (): ReturnType<typeof useFailureNotice> => {
        if (notice === null) throw new Error('notice hook did not mount')
        return notice
      }
      await act(async () => readNotice().setTurnFailure('the turn paused'))
      await frameShowing({ setup, text: 'the turn paused' })
      expect(readNotice().dismissalFor(null)).toBeNull()
      expect(readNotice().dismissalFor({ message: null })).toBeNull()
      expect(readNotice().failure).toBe('the turn paused')
      await act(async () => readNotice().setFailure('compaction failed'))
      await frameShowing({ setup, text: 'compaction failed' })
      expect(readNotice().dismissalFor(null)).not.toBeNull()
    } finally {
      await teardown(setup)
    }
  })

  const reportedFailures: readonly (StepFailure | null)[] = [null, { message: null }, { message: 'the turn failed' }]
  for (const reported of reportedFailures) {
    it(`offers dismissal only when the visible failure is transient: ${JSON.stringify(reported)}`, async () => {
      let notice: ReturnType<typeof useFailureNotice> | null = null
      function Probe(): React.ReactNode {
        notice = useFailureNotice()
        return <text>{notice.failure ?? 'no notice'}</text>
      }
      const setup = await testRender(<Probe />, { width: 60, height: 5 })
      try {
        await frameShowing({ setup, text: 'no notice' })
        const readNotice = (): ReturnType<typeof useFailureNotice> => {
          if (notice === null) throw new Error('notice hook did not mount')
          return notice
        }
        expect(readNotice().dismissalFor(reported)).toBeNull()
        await act(async () => readNotice().setFailure('compaction failed'))
        await frameShowing({ setup, text: 'compaction failed' })
        const handleDismiss = readNotice().dismissalFor(reported)
        if (reported !== null) {
          expect(handleDismiss).toBeNull()
          return
        }
        expect(handleDismiss).not.toBeNull()
        await act(async () => handleDismiss?.())
        expect(await frameShowing({ setup, text: 'no notice' })).not.toContain('compaction failed')
      } finally {
        await teardown(setup)
      }
    })
  }
})
