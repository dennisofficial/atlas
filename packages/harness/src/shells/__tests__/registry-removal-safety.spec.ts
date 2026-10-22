import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellStatus, toThreadId } from '@dltech/atlas-core'
import { HookChain } from '../../hooks/registry'
import { RandomIds } from '../../store/ids'
import { SystemClock } from '../../store/clock'
import { ShellLauncherPort, type ShellAttachment, type ShellExit } from '../port'
import { toShellId } from '../shell-id'
import { BunShellRegistry, KILL_SETTLE_MS } from '../shell-registry'
import { RecordingLog } from './shell-registry-log'

const THREAD = toThreadId('removal-safety')

class ControlledLauncher extends ShellLauncherPort {
  private observer: ((exit: ShellExit) => void) | undefined
  readonly bytes = new TextEncoder().encode('output survives a refused rewind\n')

  constructor(private readonly directory: string) { super() }

  async launch() {
    const attachment: ShellAttachment = {
      shellId: toShellId('shell_removal'),
      startedAt: new Date().toISOString(),
      outputPath: join(this.directory, 'spool.out'),
      cursorPath: join(this.directory, 'cursor'),
      inputSupported: true,
      totalBytes: () => this.bytes.length,
      readOutput: async ({ start, limit }) => this.bytes.slice(start, start + limit),
      writeInput: async () => ({ ok: true }),
      kill: () => undefined,
      watch: ({ onExit }) => { this.observer = onExit },
      detach: async () => undefined,
    }
    return { ok: true as const, attachment }
  }

  async inspect() { return [] }

  finish(): void {
    this.observer?.({ status: EShellStatus.Exited, exitCode: 0, totalBytes: this.bytes.length })
  }
}

describe('confirmed rewind removal', () => {
  it('refuses a cut when a shell has not died and still journals its eventual ending', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-removal-safety-'))
    const launcher = new ControlledLauncher(directory)
    const log = new RecordingLog()
    const registry = new BunShellRegistry({
      root: directory,
      clock: new SystemClock(),
      hooks: () => new HookChain({}),
      launcher,
      log,
      ids: new RandomIds(),
    })
    try {
      const started = await registry.start({ threadId: THREAD, command: 'controlled job', description: 'test a refused cut' })
      if (!started.ok) throw new Error(started.reason)
      await expect(registry.removeShells({
        threadId: THREAD,
        shellIds: [started.snapshot.shellId],
        by: EKilledBy.Rewind,
      })).rejects.toThrow('has not stopped')
      expect(registry.list({ threadId: THREAD })).toHaveLength(1)
      launcher.finish()
      expect(await registry.awaitEndings({ threadId: THREAD, ms: KILL_SETTLE_MS })).toBe(0)
      expect(log.appended.filter((draft) => draft.type === 'background-shell-ended')).toHaveLength(1)
      const read = await registry.read({ threadId: THREAD, shellId: started.snapshot.shellId })
      expect(read.ok && read.delta.text).toBe('output survives a refused rewind\n')
    } finally {
      launcher.finish()
      await registry.detachAll()
      await rm(directory, { recursive: true, force: true })
    }
  }, KILL_SETTLE_MS + 5_000)
})
