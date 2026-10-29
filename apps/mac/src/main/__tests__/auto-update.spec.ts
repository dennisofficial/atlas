import { describe, expect, test } from 'bun:test'
import { checkAndDownload, runUpdateCycle, type IUpdaterPort } from '../auto-update'

function fakeUpdater({ available, error = '' }: { available: boolean; error?: string }) {
  const calls: string[] = []
  const updater: IUpdaterPort = {
    checkForUpdate: async () => ({ updateAvailable: available, error }),
    downloadUpdate: async () => void calls.push('download'),
    updateInfo: () => ({ updateReady: true }),
  }
  return { updater, calls }
}

describe('auto-update', () => {
  test('does not download when current', async () => {
    const { updater, calls } = fakeUpdater({ available: false })
    expect(await checkAndDownload({ updater })).toBe(false)
    expect(calls).toEqual([])
  })
  test('applies only after the user accepts', async () => {
    const applied: string[] = []
    const { updater } = fakeUpdater({ available: true })
    await runUpdateCycle({
      updater,
      prompt: async () => false,
      apply: async () => void applied.push('x'),
    })
    expect(applied).toEqual([])
    await runUpdateCycle({
      updater,
      prompt: async () => true,
      apply: async () => void applied.push('x'),
    })
    expect(applied).toEqual(['x'])
  })
  test('swallows updater errors', async () => {
    const { updater } = fakeUpdater({ available: true, error: 'HTTP 404' })
    await runUpdateCycle({ updater, prompt: async () => true, apply: async () => {} })
  })
})
