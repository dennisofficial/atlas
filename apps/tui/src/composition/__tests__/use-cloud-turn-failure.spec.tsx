import { toRunId } from '@dltech/atlas-core'
import { EClientFrame } from '@dltech/atlas-harness'
import { afterEach, describe, expect, it } from 'bun:test'

import { ECommandEffect } from '../commands/local-command'
import { dismissNotice } from '../../ui/notice-store'
import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeApp, scriptedModelPort } from './fake-app'
import { mounted, seeded, THREAD, wire } from './cloud-turn-state-fixture'

await grammarsReady()
afterEach(() => dismissNotice())

const MESSAGE = 'The sandbox runner threw.'

async function arranged() {
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'unused' } }) })
  const channel = wire(app)
  const opened = await seeded(app, [{ type: 'user-said', text: 'work on the cloud state' }])
  channel.ready(false)
  const screen = await mounted({ app, opened })
  return { app, channel, screen }
}

describe('a remote turn ending with an error instead of an outcome', () => {
  it('settles an automatic failed turn and refreshes its log and queued commands', async () => {
    const { app, channel, screen } = await arranged()
    try {
      channel.signal({ type: 'turn-working', working: true })
      await screen.until((frame) => frame.includes('esc to interrupt'), 'automatic working state')
      let settled = false
      const waiting = screen.conversation().whenSettled().then(() => { settled = true })
      const ran: string[] = []
      screen.conversation().handleQueueSettled({
        name: 'done', text: '/done', dropsQueue: false, losesWaiting: false,
        run: () => { ran.push('done'); return { type: ECommandEffect.Ran } },
      })
      await app.log.append({
        threadId: THREAD, runId: toRunId('run-failed'),
        drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'partial answer' }], interrupted: true }],
      })
      channel.signal({ type: 'turn-working', working: false })
      await screen.quiet(100)
      expect(settled).toBe(false)
      channel.fail(MESSAGE)
      await screen.until(() => settled, 'failed turn settlement')
      await waiting
      const frame = await screen.until((text) => text.includes(MESSAGE), 'the named failure')
      expect(frame).toContain('partial answer')
      expect(ran).toEqual(['done'])
      expect(screen.conversation().turnInFlight()).toBe(false)
    } finally { await screen.done() }
  }, 30_000)

  it('settles a locally driven remote turn after the runner rejects', async () => {
    const { channel, screen } = await arranged()
    try {
      screen.conversation().handleSend({ text: 'start a turn' })
      await screen.until(() => channel.frames.some((frame) => frame.kind === EClientFrame.Send), 'the remote say')
      channel.signal({ type: 'turn-working', working: true })
      let settled = false
      const waiting = screen.conversation().whenSettled().then(() => { settled = true })
      channel.signal({ type: 'turn-working', working: false })
      channel.fail(MESSAGE)
      await screen.until(() => settled, 'driven failed turn settlement')
      await waiting
      expect(screen.conversation().working).toBe(false)
      expect(screen.conversation().turnInFlight()).toBe(false)
    } finally { await screen.done() }
  }, 30_000)

  it('does not settle a working turn because a send or transport reports an unrelated error', async () => {
    const { channel, screen } = await arranged()
    try {
      channel.signal({ type: 'turn-working', working: true })
      await screen.until((frame) => frame.includes('esc to interrupt'), 'working state')
      let settled = false
      void screen.conversation().whenSettled().then(() => { settled = true })
      channel.fail('A send was refused.')
      await screen.quiet(100)
      expect(settled).toBe(false)
      expect(screen.conversation().working).toBe(true)
      channel.signal({ type: 'turn-working', working: false })
      channel.fail(MESSAGE)
      await screen.until(() => settled, 'actual failed turn settlement')
    } finally { await screen.done() }
  }, 30_000)
})
