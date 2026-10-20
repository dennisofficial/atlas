import { describe, expect, it } from 'bun:test'

import { mkdtempSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.ATLAS_HOME = join(mkdtempSync(join(tmpdir(), 'atlas-launch-detached-')), '.atlas-home')

import type { SpawnCommand } from '@dltech/atlas-core'

import { LocalProcessPort, type LocalProcessHandle } from '../local-process'
import { LoginEnvProcessPort } from '../login-env-process'

class RecordingProcesses extends LocalProcessPort {
  readonly launched: SpawnCommand[] = []

  override spawn(): LocalProcessHandle {
    throw new Error('launchDetached must not spawn a tracked process')
  }

  override async launchDetached(args: SpawnCommand): Promise<void> {
    this.launched.push(args)
  }
}

describe('LocalProcessPort.launchDetached', () => {
  it('starts a process that outlives the call and needs no pipes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-detached-'))
    try {
      const marker = join(directory, 'marker')
      await new LocalProcessPort().launchDetached({
        cmd: ['sh', '-c', 'sleep 0.2; printf %s "$ATLAS_DETACHED_PROBE" > "$1"', 'sh', marker],
        cwd: directory,
        env: { PATH: process.env.PATH, ATLAS_DETACHED_PROBE: 'ran' },
      })

      await expect(readFile(marker, 'utf8')).rejects.toThrow()
      const deadline = Date.now() + 5_000
      let written = ''
      while (written === '' && Date.now() < deadline) {
        written = await readFile(marker, 'utf8').catch(() => '')
        if (written === '') await Bun.sleep(25)
      }
      expect(written).toBe('ran')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('LoginEnvProcessPort.launchDetached', () => {
  it('forwards the command untouched to the inner port', async () => {
    const inner = new RecordingProcesses()
    const command: SpawnCommand = { cmd: ['bun', 'x.js'], cwd: '/tmp', env: { A: '1' } }

    await new LoginEnvProcessPort(inner).launchDetached(command)

    expect(inner.launched).toEqual([command])
  })
})
