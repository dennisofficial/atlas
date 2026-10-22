import { beforeEach, describe, expect, it } from 'bun:test'
import { applyTranscriptCovered, transcriptCovered } from '../../ui/covered-store'
import { teardown } from '../../ui/markdown/__tests__/harness'
import { appWith, onSettings, opened } from './app-settings-fixture'

beforeEach(() => applyTranscriptCovered(false))

async function coveredOnceSettled({
  within,
  awaiting = false,
}: {
  within: number
  awaiting?: boolean
}): Promise<boolean> {
  const deadline = Date.now() + within
  while (transcriptCovered() !== awaiting && Date.now() < deadline) await Bun.sleep(5)
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
      expect(await coveredOnceSettled({ within: 5_000, awaiting: true })).toBe(true)

      setup.mockInput.pressEscape()
      expect(await coveredOnceSettled({ within: 5_000 })).toBe(false)
    } finally {
      await teardown(setup)
    }
  }, 60_000)
})
