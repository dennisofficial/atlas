import { describe, expect, it } from 'bun:test'

import { createHash } from 'node:crypto'
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

const fakeSandbox = (state: {
  version?: string
  alive: boolean
  listens: boolean
  answersAsDaemon?: boolean
  acceptsDrain?: boolean
  closesOnDrain?: boolean
}) => {
  const commands: RecordedCommand[] = []
  const listeningAtBoot: boolean[] = []
  let drained = false
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
      if (params.detached === true) {
        listeningAtBoot.push(state.listens)
        if (drained) state.listens = true
        return { exitCode: 0 }
      }
      if (script.startsWith('curl') && script.includes('/drain')) {
        if (!(state.acceptsDrain ?? false)) return { exitCode: 7, stdout: async () => '000' }
        if (state.closesOnDrain ?? true) {
          state.listens = false
          drained = true
        }
        return { exitCode: 0, stdout: async () => '202' }
      }
      if (script.startsWith(`cat ${daemonPaths.version}`)) {
        return { exitCode: 0, stdout: async () => state.version ?? '' }
      }
      if (script.includes('echo alive')) {
        return { exitCode: 0, stdout: async () => (state.alive ? 'alive' : '') }
      }
      if (script.startsWith('curl')) {
        const body = (state.answersAsDaemon ?? true) ? 'atlas-daemon' : 'vite dev server'
        const port = state.listens ? `printf '%s\\n' '${body}'` : 'false'
        const probe = Bun.spawnSync(['sh', '-c', script.replace(/^curl -s \S+/, port)])
        return { exitCode: probe.exitCode }
      }
      return { exitCode: 0, stdout: async () => '' }
    },
  }
  return { sandbox: sandbox as unknown as Sandbox, commands, writes, listeningAtBoot }
}

const isDrain = (command: RecordedCommand): boolean => (command.args[1] ?? '').includes('/drain')

const isKill = (command: RecordedCommand): boolean => (command.args[1] ?? '').includes('kill -9')

const bundle = (content = '// daemon bundle\n') => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-daemon-bundle-'))
  const path = join(dir, 'daemon.js')
  writeFileSync(path, content)
  return {
    bundle: { path },
    version: createHash('sha256').update(content).digest('hex'),
    cleanup: () => rmSync(dir, { recursive: true }),
  }
}

describe('launchDaemon', () => {
  it('starts the daemon detached with the token only in that runCommand env', async () => {
    const { bundle: b, version, cleanup } = bundle()
    try {
      const { sandbox, writes } = fakeSandbox({ alive: false, listens: true })
      await launchDaemon({ sandbox, bundle: b, token: 'tok-1', sandboxName: 'atlas-v2-s1' })

      const detached = commands.filter((command) => command.detached === true)
      expect(detached.length).toBe(1)
      expect(detached[0]?.args[1]).toContain('flock -w 5')
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
      expect(commands.some(isDrain)).toBe(false)
      const paths = writes.map((write) => write.path)
      expect(paths).toContain(daemonPaths.bundle)
      expect(paths).toContain(daemonPaths.version)
      expect(writes.find((write) => write.path === daemonPaths.version)?.content).toBe(version)
    } finally {
      cleanup()
    }
  })

  it('keeps an alive daemon at the same version without re-uploading and still waits for listen', async () => {
    const { bundle: b, version, cleanup } = bundle()
    try {
      const { sandbox, commands, writes } = fakeSandbox({ version, alive: true, listens: true })
      await launchDaemon({ sandbox, bundle: b, token: 'tok-1', sandboxName: 'atlas-v2-s1' })
      expect(writes).toEqual([])
      expect(commands.filter((command) => command.detached === true)).toEqual([])
      expect(commands.some((command) => (command.args[1] ?? '').startsWith('curl'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('re-uploads and restarts when the stored version differs from the bundle hash', async () => {
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
      const killed = commands.find(
        (command) => command.detached !== true && (command.args[1] ?? '').includes('kill'),
      )
      expect(killed).toBeDefined()
      expect(killed?.args[1]).toContain('kill -0')
      expect(commands.filter(isDrain).length).toBe(1)
      expect(commands.filter(isKill).length).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('drains a live daemon of another version instead of killing it', async () => {
    const { bundle: b, cleanup } = bundle()
    try {
      const lines: string[] = []
      const { sandbox, commands, writes, listeningAtBoot } = fakeSandbox({
        version: 'v-old',
        alive: true,
        listens: true,
        acceptsDrain: true,
      })
      await launchDaemon({
        sandbox,
        bundle: b,
        token: 'tok-1',
        sandboxName: 'atlas-v2-s1',
        log: (line) => lines.push(line),
      })
      const drains = commands.filter(isDrain)
      expect(drains.length).toBe(1)
      expect(drains[0]?.env).toEqual({ ATLAS_DRAIN_TOKEN: 'tok-1' })
      expect(drains[0]?.args[1]).toContain('http://localhost:3000/drain')
      expect(drains[0]?.args[1]).toContain('{"deadlineMs":600000}')
      expect(commands.some(isKill)).toBe(false)
      expect(listeningAtBoot).toEqual([false])
      expect(writes.map((write) => write.path)).toContain(daemonPaths.bundle)
      expect(lines.some((line) => line.includes('draining'))).toBe(true)
      expect(lines.some((line) => line.includes('drained'))).toBe(true)
      for (const command of commands.filter((candidate) => candidate.detached !== true)) {
        expect(command.args[1] ?? '').not.toContain('tok-1')
        if (!isDrain(command)) expect(JSON.stringify(command.env ?? {})).not.toContain('tok-1')
      }
    } finally {
      cleanup()
    }
  })

  it('kills the old daemon when it does not close within the drain budget', async () => {
    const { bundle: b, cleanup } = bundle()
    try {
      const lines: string[] = []
      const { sandbox, commands } = fakeSandbox({
        version: 'v-old',
        alive: true,
        listens: true,
        acceptsDrain: true,
        closesOnDrain: false,
      })
      await launchDaemon({
        sandbox,
        bundle: b,
        token: 'tok-1',
        sandboxName: 'atlas-v2-s1',
        drainBudgetMs: 600,
        log: (line) => lines.push(line),
      })
      expect(commands.filter(isDrain).length).toBe(1)
      expect(commands.filter(isKill).length).toBe(1)
      expect(commands.filter((command) => command.detached === true).length).toBe(1)
      expect(lines.some((line) => line.includes('did not drain within'))).toBe(true)
    } finally {
      cleanup()
    }
  })

  it('re-uploads when the bundle content changed while an old daemon is alive', async () => {
    const { bundle: b, version, cleanup } = bundle('// daemon bundle v2\n')
    try {
      const { sandbox, writes } = fakeSandbox({
        version,
        alive: true,
        listens: true,
      })
      await launchDaemon({ sandbox, bundle: b, token: 'tok-1', sandboxName: 'atlas-v2-s1' })
      expect(writes).toEqual([])
      const changed = await Bun.file(b.path).text()
      writeFileSync(b.path, `${changed}more\n`)
      const {
        sandbox: second,
        commands: secondCommands,
        writes: secondWrites,
      } = fakeSandbox({
        version,
        alive: true,
        listens: true,
      })
      await launchDaemon({ sandbox: second, bundle: b, token: 'tok-1', sandboxName: 'atlas-v2-s1' })
      expect(secondWrites.map((write) => write.path)).toContain(daemonPaths.bundle)
      expect(secondCommands.filter((command) => command.detached === true).length).toBe(1)
    } finally {
      cleanup()
    }
  })

  it('fails the launch when the port answers with something other than the daemon', async () => {
    const { bundle: b, cleanup } = bundle()
    try {
      const { sandbox } = fakeSandbox({ alive: false, listens: true, answersAsDaemon: false })
      await expect(
        launchDaemon({
          sandbox,
          bundle: b,
          token: 'tok-1',
          sandboxName: 'atlas-v2-s1',
          listenBudgetMs: 1200,
        }),
      ).rejects.toThrow('did not answer atlas-daemon')
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
      ).rejects.toThrow('did not answer atlas-daemon')
    } finally {
      cleanup()
    }
  })
})
