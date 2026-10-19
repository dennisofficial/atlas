import { afterEach, describe, expect, test } from 'bun:test'

import { EExitCause, inspectDurableShell } from '../client'
import { launchOrThrow, scratchDirectory } from './fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function waitForExit({ shellDir, deadlineMs }: { shellDir: string; deadlineMs: number }) {
  const giveUpAt = Date.now() + deadlineMs
  while (Date.now() < giveUpAt) {
    const exit = (await inspectDurableShell({ shellDir })).status?.exit
    if (exit !== undefined) return exit
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return undefined
}

describe('the timeout ceiling under the default tick', () => {
  test('a short ceiling ends the shell with the timeout cause long before the tick interval', async () => {
    const { shellDir, cleanup } = await scratchDirectory()
    cleanups.push(cleanup)

    const startedAt = Date.now()
    const handle = await launchOrThrow({ shellDir, timeoutMs: 300, command: 'sleep 30' })
    await handle.detach()
    const exit = await waitForExit({ shellDir, deadlineMs: 4_000 })

    expect(exit?.cause).toBe(EExitCause.Timeout)
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })
})
