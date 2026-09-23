import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import {
  ClockPort,
  EKilledBy,
  EShellStatus,
  ProcessPort,
  toThreadId,
  type ProcessHandle,
} from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { startBackgroundShell, type BackgroundShell } from '../background-shell'
import { toShellId } from '../shell-id'
import { BunShellRegistry } from '../shell-registry'
import { endedDraft, job, settle } from './shell-registry-fixture'

const THREAD = toThreadId('thread-under-test')

class FixedClock extends ClockPort {
  now(): string {
    return '2026-09-18T12:00:00.000Z'
  }
}

const neverFlowing = (): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({ start: () => {} })

class UnreadablePort extends ProcessPort {
  terminateCalls = 0
  private failReading: ((error: Error) => void) | undefined

  spawn(): ProcessHandle {
    return {
      stdout: neverFlowing(),
      stderr: neverFlowing(),
      exited: new Promise<number>((_, reject) => {
        this.failReading = reject
      }),
      terminate: () => {
        this.terminateCalls += 1
      },
    }
  }

  loseContact(): void {
    this.failReading?.(new Error('The operation timed out'))
  }

  which(): string | null {
    return null
  }
}

const started = (
  processes: UnreadablePort,
  onExit: (shell: BackgroundShell) => void = () => {},
) =>
  startBackgroundShell({
    shellId: toShellId('bash_1'),
    threadId: THREAD,
    command: 'next dev',
    description: 'Run the dev server',
    cwd: '/work',
    clock: new FixedClock(),
    retainCharacters: 400_000,
    overflowCharacters: 50_000_000,
    promptSettleMs: 2_000,
    matchSettleMs: 100,
    matchedLinesCap: 200,
    processes,
    onExit,
    onAwaitingInput: () => {},
    onMatched: () => {},
    onStillRunning: () => {},
  })

describe('a background shell the harness can no longer read', () => {
  it('is killed as lost contact rather than reported as finished', async () => {
    const processes = new UnreadablePort()
    let announced: BackgroundShell | undefined
    const opened = started(processes, (shell) => {
      announced = shell
    })
    if (!opened.ok) throw new Error('the shell did not start')

    processes.loseContact()
    await opened.shell.exited

    const snapshot = opened.shell.snapshot()
    expect(snapshot.status).toBe(EShellStatus.Killed)
    expect(snapshot.threadId).toBe(THREAD)
    expect(snapshot.killedBy).toBe(EKilledBy.LostContact)
    expect(processes.terminateCalls).toBe(1)
    expect(announced).toBe(opened.shell)
    expect(opened.shell.tail(2_000)).toContain('could not read this shell to the end')
  })

  it('announces the ending through the registry as a lost contact, not a finish', async () => {
    const root = mkdtempSync(join(tmpdir(), 'atlas-shells-lost-'))
    const processes = new UnreadablePort()
    const registry = new BunShellRegistry(root, new FixedClock(), () => new HookChain({}), processes)

    const startedShell = registry.start(job({ command: 'next dev' }))
    if (!startedShell.ok) throw new Error('the shell did not start')

    processes.loseContact()
    await settle({ registry, shellId: startedShell.snapshot.shellId })

    const drafts = registry.drainNotifications({ threadId: THREAD })
    const ended = endedDraft(drafts[0])
    expect(ended.status).toBe(EShellStatus.Killed)
    expect(ended.killedBy).toBe(EKilledBy.LostContact)
    expect(ended.output).toContain('could not read this shell to the end')

    await registry.closeAll()
    rmSync(root, { recursive: true, force: true })
  })
})
