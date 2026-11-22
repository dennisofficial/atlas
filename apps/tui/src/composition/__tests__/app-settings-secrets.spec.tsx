import { toThreadId } from '@dltech/atlas-core'
import { MemorySecretsStore } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'

import { grammarsReady, settle, teardown } from '../../ui/markdown/__tests__/harness'
import { App } from '../app'
import { fakeApp, scriptedModelPort, type FakeApp } from './fake-app'

await grammarsReady()

const WIDE = { width: 150, height: 40 }
const READ_MS = 60

type Mounted = Awaited<ReturnType<typeof testRender>>

async function opened(app: FakeApp): Promise<Mounted> {
  const setup = await testRender(
    <App
      app={app}
      opened={{
        threadId: toThreadId('opened-thread'),
        events: [],
        turns: [],
        name: null,
        started: true,
      }}
    />,
    WIDE,
  )
  await setup.flush()
  await settle(250)
  await setup.flush()
  return setup
}

async function landed(setup: Mounted): Promise<void> {
  await settle(READ_MS)
  await setup.flush()
}

async function openPageWith(setup: Mounted, needle: string): Promise<void> {
  setup.mockInput.pressKey('o', { ctrl: true })
  await landed(setup)

  for (let step = 0; step < 8; step += 1) {
    if (setup.captureCharFrame().includes(needle)) return
    setup.mockInput.pressTab()
    await landed(setup)
  }

  throw new Error(`never reached the settings page holding ${needle}`)
}

const rowShowing = (setup: Mounted, needle: string): string =>
  setup
    .captureCharFrame()
    .split('\n')
    .find((line) => line.includes(needle)) ?? ''

describe('the secret-kind settings rows', () => {
  it('shows the masked value of a secret another tile set before settings opened', async () => {
    const secrets = new MemorySecretsStore({
      label: 'settings-secrets spec',
      secrets: { 'decisions.token.typesafe': 'decision-key-1234' },
    })
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
      secretsPort: secrets,
    })
    const setup = await opened(app)

    try {
      await openPageWith(setup, 'Decision key')

      const row = rowShowing(setup, 'Decision key')
      expect(row).toContain('••••1234')
      expect(row).not.toContain('not set')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
