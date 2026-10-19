import { beforeEach, describe, expect, it } from 'bun:test'
import { applyTranscriptCovered, transcriptCovered } from '../../ui/covered-store'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { appWith, landed, onSettings, opened } from './app-settings-fixture'

beforeEach(() => applyTranscriptCovered(false))

async function coveredOnceSettled({ within }: { within: number }): Promise<boolean> {
  const deadline = Date.now() + within
  while (transcriptCovered() && Date.now() < deadline) await Bun.sleep(5)
  return transcriptCovered()
}

describe('the pictures-covered flag', () => {
  it('is raised while an overlay is open and dropped when the app unmounts under it', async () => {
    const setup = await onSettings(appWith())

    try {
      expect(transcriptCovered()).toBe(true)
    } finally {
      await teardown(setup)
    }

    expect(await coveredOnceSettled({ within: 2_000 })).toBe(false)
  }, 60_000)

  it('follows the overlay closing without waiting for the unmount', async () => {
    const setup = await opened(appWith())

    try {
      expect(transcriptCovered()).toBe(false)

      setup.mockInput.pressKey('o', { ctrl: true })
      await landed(setup)
      expect(transcriptCovered()).toBe(true)

      setup.mockInput.pressEscape()
      await landed(setup)
      expect(transcriptCovered()).toBe(false)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
