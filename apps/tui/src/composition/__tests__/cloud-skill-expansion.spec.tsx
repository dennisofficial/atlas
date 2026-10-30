import { EClientFrame } from '@dltech/atlas-harness'
import { ECapability } from '@dltech/atlas-wire'
import { describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { mounted, seeded, THREAD, wire } from './cloud-turn-state-fixture'
import { fakeApp, fakeSkill, scriptedModelPort } from './fake-app'

await grammarsReady()

const steerWith = async (capabilities: readonly ECapability[] | undefined) => {
  const app = fakeApp({
    model: scriptedModelPort({ script: { thinking: '', reply: 'unused' }, perChunkMs: 1 }),
    skills: [fakeSkill({ name: 'pirate', body: 'Talk like a pirate.' })],
  })
  const channel = wire(app)
  const opened = await seeded(app, [{ type: 'user-said', text: 'hi' }])
  channel.ready(true, capabilities)
  channel.signal({ type: 'turn-working', working: true })
  const screen = await mounted({ app, opened })
  try {
    await screen.until((frame) => frame.includes('esc to interrupt'), 'the working line')
    screen.conversation().handleSend({ text: '/pirate ahoy' })
    await screen.quiet(200)
    return channel.frames.filter((frame) => frame.kind === EClientFrame.Send)
  } finally {
    await screen.done()
  }
}

describe('skill expansion on a cloud steer', () => {
  it('attaches the skill client-side for a serve without command-list', async () => {
    const sends = await steerWith(undefined)
    expect(sends).toHaveLength(1)
    expect(JSON.stringify(sends[0])).toContain('Talk like a pirate.')
  })

  it('sends text only to a serve that advertises command-list', async () => {
    const sends = await steerWith([ECapability.CommandList])
    expect(sends).toHaveLength(1)
    expect(JSON.stringify(sends[0])).not.toContain('Talk like a pirate.')
  })
})
