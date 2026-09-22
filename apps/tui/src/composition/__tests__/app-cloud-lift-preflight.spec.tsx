import { describe, expect, it } from 'bun:test'

import { grammarsReady } from '../../ui/markdown/__tests__/harness'
import { fakeBridge } from '../cloud/__tests__/fixture'
import { mount, speaking } from './app-container-cloud-fixture'

await grammarsReady()

const MISSING_VERCEL =
  'cloud sandboxes run on your own Vercel account — add your Vercel token under settings (ctrl+o) › cloud, then try again'

describe('/container cloud preflight', () => {
  it('refuses before anything moves when the credentials are missing', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    const mounted = await mount({ app, bridge, preflightLift: async () => MISSING_VERCEL })

    try {
      const frame = await mounted.run('cloud')

      expect(frame).toContain('add your Vercel token')
      expect(frame).toContain('ctrl+o')
      expect(frame).not.toContain('MOVING TO THE CLOUD')
      expect(frame).not.toContain('moving to the cloud')
      expect(bridge.created).toHaveLength(0)
      expect(bridge.attached).toHaveLength(0)
      expect(app.threads.chosenLocations).toHaveLength(0)
    } finally {
      await mounted.done()
    }
  }, 60_000)

  it('a second attempt is not held off by the first refusal', async () => {
    const app = speaking()
    const bridge = fakeBridge()
    let configured = false
    const mounted = await mount({
      app,
      bridge,
      preflightLift: async () => (configured ? null : MISSING_VERCEL),
    })

    try {
      const refused = await mounted.run('cloud')
      expect(refused).toContain('add your Vercel token')

      configured = true
      await mounted.run('cloud')

      expect(bridge.created).toHaveLength(1)
    } finally {
      await mounted.done()
    }
  }, 60_000)
})
