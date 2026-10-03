import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { EExitCause, EOverflowEvidence, EShellSignal, inspectDurableShell } from '../client'
import { collect, isAlive, launchOrThrow, readUntil, scratchDirectory } from './fixture'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function scratch(): Promise<string> {
  const made = await scratchDirectory()
  cleanups.push(made.cleanup)
  return made.shellDir
}

async function waitForExit({ shellDir }: { shellDir: string }) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const inspection = await inspectDurableShell({ shellDir })
    if (inspection.status?.exit !== undefined) return inspection.status.exit
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return undefined
}

describe('process group lifecycle', () => {
  test('terminate signals the whole child group, grandchildren included', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300 & echo "grandchild:$!"; wait' })
    const { text } = await readUntil({ stream: handle.stdout, pattern: '\n' })
    const grandchild = Number(/grandchild:(\d+)/.exec(text)?.[1])
    expect(isAlive({ pid: grandchild })).toBe(true)

    handle.terminate()
    expect(await handle.exited).toBe(143)
    const settled = await handle.settled
    expect(settled.kind === 'exited' && settled.exit.cause).toBe(EExitCause.Terminated)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(isAlive({ pid: grandchild })).toBe(false)
  })

  test('a signal ignored by the child is followed by a bounded SIGKILL', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({
      shellDir,
      killGraceMs: 300,
      command: "trap '' TERM; echo armed; while true; do sleep 0.05; done",
    })
    await readUntil({ stream: handle.stdout, pattern: 'armed' })
    handle.terminate()
    expect(await handle.exited).toBe(137)
  })

  test('a natural exit reaps grandchildren that kept the spool open', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300 & echo "gc:$!"' })
    const text = await collect({ stream: handle.stdout })
    const grandchild = Number(/gc:(\d+)/.exec(text)?.[1])
    expect(await handle.exited).toBe(0)
    expect(isAlive({ pid: grandchild })).toBe(false)
  })

  test('signal delivers a chosen signal to the group', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({
      shellDir,
      command: "trap 'echo usr1' USR1; echo up; while true; do sleep 0.05; done",
    })
    const { reader } = await readUntil({ stream: handle.stdout, pattern: 'up' })
    expect((await handle.signal(EShellSignal.User1)).ok).toBe(true)
    let text = ''
    while (!text.includes('usr1')) text += new TextDecoder().decode((await reader.read()).value)
    await handle.kill()
    expect(await handle.exited).toBe(137)
  })

  test('large unread input is refused rather than hanging the supervisor', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    const chunk = 'x'.repeat(400 * 1024)
    let refused = false
    for (let index = 0; index < 40 && !refused; index += 1) refused = !(await handle.writeInput(chunk)).ok
    expect(refused).toBe(true)
    handle.terminate()
    await handle.exited
  })

  test('closeInput delivers EOF', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'cat; echo eof-seen' })
    await handle.writeInput('abc\n')
    await handle.closeInput()
    expect(await collect({ stream: handle.stdout })).toBe('abc\neof-seen\n')
  })
})

describe('output cap', () => {
  test('a tiny kernel cap stops the writer and records the spool at the limit', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, outputLimitBytes: 4096, command: 'yes | head -c 100000; echo after' })
    await handle.exited
    const settled = await handle.settled
    if (settled.kind !== 'exited') throw new Error('expected exit')
    expect(settled.exit.spoolBytes).toBe(4096)
    expect(settled.exit.overflowEvidence).toContain(EOverflowEvidence.SpoolAtLimit)
  })

  test('a leader killed by SIGXFSZ is classified output-limit', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, outputLimitBytes: 2048, command: 'exec yes' })
    await handle.exited
    const settled = await handle.settled
    if (settled.kind !== 'exited') throw new Error('expected exit')
    expect(settled.exit.signal).toBe('SIGXFSZ')
    expect(settled.exit.cause).toBe(EExitCause.OutputLimit)
    expect(settled.exit.overflowEvidence).toContain(EOverflowEvidence.LeaderKilledBySigxfsz)
  })

  test('output exactly at the cap with a clean exit is still a natural completion', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({
      shellDir,
      outputLimitBytes: 1024,
      command: 'head -c 1023 /dev/zero | tr "\\0" a; echo',
    })
    await handle.exited
    const settled = await handle.settled
    if (settled.kind !== 'exited') throw new Error('expected exit')
    expect(settled.exit.cause).toBe(EExitCause.Natural)
    expect(settled.exit.exitCode).toBe(0)
  })

  test('the cap is applied in 1024-byte units before the command runs', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, outputLimitBytes: 8192, command: 'ulimit -f; ulimit -f unlimited 2>&1 | head -1' })
    const text = await collect({ stream: handle.stdout })
    expect(text.split('\n')[0]).toBe('8')
    expect(text.split('\n')[1]).toBeDefined()
  })
})

describe('supervisor loss and expiry', () => {
  test('a SIGKILLed supervisor is reported as lost, never as an exit', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, command: 'sleep 300' })
    const inspection = await inspectDurableShell({ shellDir })
    process.kill(inspection.meta?.supervisor.pid ?? 0, 'SIGKILL')
    const settled = await handle.settled
    expect(settled.kind).toBe('lost')
    expect(await handle.exited).toBe(-1)
    expect(handle.snapshot().phase).toBe('lost')
    process.kill(-handle.pid, 'SIGKILL')
  })

  test('an unattended shell with no session lock expires after the ttl', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, ttlMs: 400, tickMs: 50, leaseMs: 100, command: 'sleep 300' })
    await handle.detach()
    const exit = await waitForExit({ shellDir })
    expect(exit?.cause).toBe(EExitCause.Expired)
  })

  test('a live heartbeat keeps the shell past the ttl', async () => {
    const shellDir = await scratch()
    const handle = await launchOrThrow({ shellDir, ttlMs: 500, tickMs: 50, leaseMs: 150, command: 'sleep 300' })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(isAlive({ pid: handle.pid })).toBe(true)
    handle.terminate()
    await handle.exited
  })

  test('a live session lock in the same namespace keeps an unattended shell alive', async () => {
    const shellDir = await scratch()
    const lockFile = join(shellDir, '..', 'lock')
    await Bun.write(lockFile, JSON.stringify({ pid: process.pid }))
    const handle = await launchOrThrow({
      shellDir,
      ttlMs: 500,
      tickMs: 50,
      leaseMs: 100,
      command: 'sleep 300',
      sessionLock: { lockFile },
    })
    await handle.detach()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(isAlive({ pid: handle.pid })).toBe(true)
    process.kill(-handle.pid, 'SIGKILL')
  })
})
