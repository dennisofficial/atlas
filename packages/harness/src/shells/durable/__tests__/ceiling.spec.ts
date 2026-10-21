import { afterEach, describe, expect, test } from 'vitest'

import { EExitCause, inspectDurableShell, sendControl } from '../client'
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

async function launchDetached({ timeoutMs, command }: { timeoutMs: number; command: string }) {
  const { shellDir, cleanup } = await scratchDirectory()
  cleanups.push(async () => {
    await sendControl({ directory: shellDir, request: { type: 'kill' } }).catch(() => undefined)
    await waitForExit({ shellDir, deadlineMs: 4_000 })
    await cleanup()
  })
  const handle = await launchOrThrow({ shellDir, timeoutMs, command })
  await handle.detach()
  return shellDir
}

describe('the timeout ceiling under the default tick', () => {
  test('a short ceiling ends the shell with the timeout cause long before the tick interval', async () => {
    const startedAt = Date.now()
    const shellDir = await launchDetached({ timeoutMs: 300, command: 'sleep 30' })
    const exit = await waitForExit({ shellDir, deadlineMs: 4_000 })

    expect(exit?.cause).toBe(EExitCause.Timeout)
    expect(Date.now() - startedAt).toBeLessThan(2_000)
  })

  test('a ceiling longer than the runtime timer range does not fire early', async () => {
    const shellDir = await launchDetached({ timeoutMs: 2 ** 31 + 1_000, command: 'sleep 0.5; exit 0' })
    const exit = await waitForExit({ shellDir, deadlineMs: 4_000 })

    expect(exit?.cause).toBe(EExitCause.Natural)
    expect(exit?.exitCode).toBe(0)
  })
})
