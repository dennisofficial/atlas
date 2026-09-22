import { ESettingId, toThreadId } from '@dltech/atlas-core'
import { MemorySecretsStore } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import { describe, expect, it } from 'bun:test'
import React from 'react'

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
      opened={{ threadId: toThreadId('opened-thread'), events: [], turns: [], name: null, started: true }}
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

async function openCloudPageWith(setup: Mounted): Promise<void> {
  setup.mockInput.pressKey('o', { ctrl: true })
  await landed(setup)

  for (let step = 0; step < 8; step += 1) {
    if (setup.captureCharFrame().includes('Vercel token')) return
    setup.mockInput.pressTab()
    await landed(setup)
  }

  throw new Error('never reached the cloud page')
}

const rowShowing = (setup: Mounted, needle: string): string =>
  setup
    .captureCharFrame()
    .split('\n')
    .find((line) => line.includes(needle)) ?? ''

describe('the secret-kind settings rows', () => {
  it('re-warms secrets when settings opens, showing a token another tile set', async () => {
    const secrets = new MemorySecretsStore({ label: 'settings-secrets spec' })
    const app = fakeApp({
      model: scriptedModelPort({ script: { thinking: 'weighing it', reply: 'done' } }),
      secretsPort: secrets,
      rewarm: () => secrets.write({ name: ESettingId.VercelToken, value: 'vercel-token-1234' }),
    })
    const setup = await opened(app)

    try {
      await openCloudPageWith(setup)

      const row = rowShowing(setup, 'Vercel token')
      expect(row).toContain('••••1234')
      expect(row).not.toContain('not set')
      expect(app.rewarms).toBe(1)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
