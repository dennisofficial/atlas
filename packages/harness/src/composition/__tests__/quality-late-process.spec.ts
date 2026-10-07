import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

import { ATLAS_SETTINGS, ProcessPort, WorkspaceIdentityPort, toThreadId, type SpawnCommand } from '@dltech/atlas-core'

import { createIsolatedContainer, portToken } from '../../container/injection'
import { LocalProcessPort } from '../../execution/local-process'
import { MemorySettingsStore } from '../../settings/memory-store'
import { createSettingsService } from '../../settings/service'
import { bindQuality } from '../compose-quality'

class RecordingProcess extends LocalProcessPort {
  calls = 0

  override spawn(args: SpawnCommand) {
    this.calls += 1
    return super.spawn(args)
  }
}

describe('quality process binding', () => {
  it('resolves the process adapter after the surface has registered its runtime adapter', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-quality-late-process-'))
    const settings = createSettingsService({ definitions: ATLAS_SETTINGS, user: new MemorySettingsStore({ label: 'late process' }) })
    const container = createIsolatedContainer()
    try {
      const init = Bun.spawn(['git', 'init', '-b', 'main', directory], { stdout: 'ignore', stderr: 'ignore' })
      expect(await init.exited).toBe(0)
      const commit = Bun.spawn(['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'root'], { cwd: directory, stdout: 'ignore', stderr: 'ignore' })
      expect(await commit.exited).toBe(0)
      const original = new RecordingProcess()
      const surface = new RecordingProcess()
      container.register(portToken(ProcessPort), { useValue: original })
      bindQuality({ container, settings })
      container.register(portToken(ProcessPort), { useValue: surface })
      const identity = await container.resolve(portToken(WorkspaceIdentityPort)).identify({ projectDirectory: directory, threadId: toThreadId('late-process') })
      expect(identity.remote).toStartWith('local:')
      expect(original.calls).toBe(0)
      expect(surface.calls).toBeGreaterThan(0)
    } finally {
      settings.close()
      await container.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
