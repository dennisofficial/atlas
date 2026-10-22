import { ESettingId } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { appWith, landed, onSettings, valueOf } from './app-settings-fixture'

describe('the settings page code-quality status', () => {
  it('shows the recorded review status on the quality page only, above the toggles', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      expect(setup.captureCharFrame()).not.toContain('last recorded review')

      for (let tab = 0; tab < 5; tab += 1) {
        setup.mockInput.pressTab()
        await landed(setup)
      }

      const frame = setup.captureCharFrame()
      expect(frame).toContain('Code quality review')
      expect(frame).toContain('Record code-quality examples')
      expect(frame).toContain('last recorded review')
      expect(frame).toContain('no recorded review')
      expect(frame.indexOf('last recorded review')).toBeLessThan(frame.indexOf('Code quality review'))

      setup.mockInput.pressTab({ shift: true })
      await landed(setup)
      expect(setup.captureCharFrame()).not.toContain('last recorded review')
    } finally {
      await teardown(setup)
    }
  }, 60_000)

  it('keeps row selection on the first toggle while the status block sits above it', async () => {
    const app = appWith()
    const setup = await onSettings(app)

    try {
      for (let tab = 0; tab < 5; tab += 1) {
        setup.mockInput.pressTab()
        await landed(setup)
      }

      expect(valueOf(app, ESettingId.QualityEnabled)).not.toBe(true)
      setup.mockInput.pressEnter()
      await landed(setup)
      expect(valueOf(app, ESettingId.QualityEnabled)).toBe(true)

      const frame = setup.captureCharFrame()
      expect(frame).toContain('review enabled')
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
