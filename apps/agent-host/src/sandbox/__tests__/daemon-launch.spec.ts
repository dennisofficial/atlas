import { describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Sandbox } from '@vercel/sandbox'

import { daemonPaths, launchDaemon } from '../daemon-launch'

type RecordedCommand = {
  cmd: string
  args: string[]
  detached?: boolean
  env?: Record<string, string>
}

type RecordedWrite = { path: string; content: string }

const fakeSandbox = (state: { version?: string; alive: boolean; listens: boolean }) => {
  const commands: RecordedCommand[] = []
  const writes: RecordedWrite[] = []
  const sandbox = {
    name: 'atlas-v2-s1',
    writeFiles: async (files: RecordedWrite[]) => {
      writes.push(...files)
    },
    runCommand: async (params: {
      cmd: string
      args?: string[]
      detached?: boolean
      env?: Record<string, string>
    }) => {
      const record: RecordedCommand = { cmd: params.cmd, args: params.args ?? [] }
      if (params.detached === true) record.detached = true
      if (params.env !== undefined) record.env = params.env
      commands.push(record)
      const script = params.args?.[1] ?? ''
      if (params.detached === true) return { exitCode: 0 }
      if (script.startsWith(`cat ${daemonPaths.version}`)) {
        return { exitCode: 0, stdout: async () => state.version ?? '' }
      }
      if (script.includes('echo alive')) {
        return { exitCode: 0, stdout: async () => (state.alive ? 'alive' : '') }
      }
      if (script.startsWith('curl')) {
        return { exitCode: state.listens ? 0 : 1 }
      }
      return { exitCode: 0, stdout: async () => '' }
    },
  }
  return { sandbox: sandbox as unknown as Sandbox, commands, writes }
}

const bundle = (): { bundle: { path: string; version: string }; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-daemon-bundle-'))
  const path = join(dir, 'daemon.js')
  writeFileSync(path, '// daemon bundle\n')
  return { bundle: { path, version: 'v-1' }, cleanup: () => rmSync(dir, { recursive: true }) }
}

describe('launchDaemon', () => {
  it('starts the daemon detached with the token only in that runCommand env', async () => {
    const { bundle: b, cleanup } = bundle()
    try {
      const { sandbox, commands, writes } = fakeSandbox({ alive: false, listens: true })
      await launchDaemon({ sandbox, bundle: b, token: 'tok-1', sandboxName: 'atlas-v2-s1' })

      const detached = commands.filter((command) => command.detached === true)
      expect(detached.length).toBe(1)
      expect(detached[0]?.env).toEqual({
        DAEMON_TOKEN: 'tok-1',
        ATLAS_SANDBOX_NAME: 'atlas-v2-s1',
        PORT: '3000',
      })
      const foreground = commands.filter((command) => command.detached !== true)
      for (const command of foreground) {
        expect(JSON.stringify(command.env ?? {})).not.toContain('tok-1')
        expect(command.args[1] ?? '').not.toContain('tok-1')
      }
      const paths = writes.map((write) => write.path)
      expect(paths).toContain(daemonPaths.bundle)
      expect(paths).toContain(daemonPaths.version)
      expect(writes.find((write) => write.path === daemonPaths.version)?.content).toBe('v-1')
    } finally {
      cleanup()
    }
  })

  it('keeps an alive daemon at the same version without re-uploading', async () => {
    const { bundle: b, cleanup } = bundle()
    try {
      const { sandbox, commands, writes } = fakeSandbox({
        version: 'v-1',
        alive: true,
        listens: true,
      })
      await launchDaemon({ sandbox, bundle: b, token: 'tok-1', sandboxName: 'atlas-v2-s1' })
      expect(writes).toEqual([])
      expect(commands.filter((command) => command.detached === true)).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('re-uploads and restarts on a version mismatch', async () => {
    const { bundle: b, cleanup } = bundle()
    try {
      const { sandbox, commands, writes } = fakeSandbox({
        version: 'v-old',
        alive: true,
        listens: true,
      })
      await launchDaemon({ sandbox, bundle: b, token: 'tok-1', sandboxName: 'atlas-v2-s1' })
      expect(writes.map((write) => write.path)).toContain(daemonPaths.bundle)
      const detached = commands.filter((command) => command.detached === true)
      expect(detached.length).toBe(1)
      const killed = commands.some(
        (command) => command.detached !== true && (command.args[1] ?? '').includes('kill'),
      )
      expect(killed).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('fails with the log tail when the daemon never listens', async () => {
    const { bundle: b, cleanup } = bundle()
    try {
      const { sandbox } = fakeSandbox({ alive: false, listens: false })
      await expect(
        launchDaemon({
          sandbox,
          bundle: b,
          token: 'tok-1',
          sandboxName: 'atlas-v2-s1',
          listenBudgetMs: 1200,
        }),
      ).rejects.toThrow('did not listen')
    } finally {
      cleanup()
    }
  })
})
