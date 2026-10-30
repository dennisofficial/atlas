import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'bun:test'

import {
  toThreadId,
  type ClockPort,
  type PortExposureOutcome,
  type ProcessHandle,
  type ProcessPort,
  type SpawnCommand,
} from '@dltech/atlas-core'

import { parseDeclaredServices } from '../declared-services'
import { BunServiceRegistry } from '../service-registry'

export const THREAD = toThreadId('thread-ensure')

class Clock implements ClockPort {
  now(): string {
    return '2026-10-29T12:00:00.000Z'
  }
}

export class Processes implements ProcessPort {
  readonly spawned: SpawnCommand[] = []
  probeExit: number | undefined
  setupExit = 0
  private readonly listening = new Set<string>()

  spawn(args: SpawnCommand): ProcessHandle {
    this.spawned.push(args)
    const isProbe = args.cmd[0] === 'curl' || args.cmd[2]?.startsWith('exec 3<>')
    let end: (code: number) => void = () => undefined
    const exited = new Promise<number>((resolve) => {
      end = resolve
    })
    if (args.cmd[1] === '-lc') end(this.setupExit)
    else if (isProbe) {
      const port = /(?:127\.0\.0\.1[:/])(\d+)/.exec(args.cmd.join(' '))?.[1] ?? ''
      end(this.probeExit ?? (this.listening.has(port) ? 0 : 1))
    } else if (args.env?.PORT !== undefined) this.listening.add(args.env.PORT)
    return {
      stdout: new ReadableStream({ start: (c) => c.close() }),
      stderr: new ReadableStream({ start: (c) => c.close() }),
      exited,
      terminate: () => end(143),
    }
  }

  which(): string | null {
    return null
  }

  async exposePort({ containerPort }: { containerPort: number }): Promise<PortExposureOutcome> {
    return {
      ok: true,
      exposure: {
        containerPort,
        hostPort: containerPort,
        url: `https://${containerPort}-x.byatlas.dev`,
      },
    }
  }

  servicesStarted(): SpawnCommand[] {
    return this.spawned.filter(
      (one) => one.cmd[0] === 'bash' && one.cmd[1] === '-c' && !one.cmd[2]?.startsWith('exec 3<>'),
    )
  }
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

export const YAML = `services:
  web:
    command: serve web
    health: /up
    portal: true
  worker:
    command: run worker
    port: 24500
`

export function open(args?: { probeExit?: number; yaml?: string }) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-ensure-'))
  roots.push(root)
  const processes = new Processes()
  processes.probeExit = args?.probeExit
  const file = { yaml: args?.yaml ?? YAML }
  const registry = new BunServiceRegistry({
    root,
    clock: new Clock(),
    logsDirectory: join(root, 'logs'),
    processes,
    declared: {
      load: async () => parseDeclaredServices({ text: file.yaml, file: 'services.yaml' }),
      timing: { budgetMs: 50, intervalMs: 5, sleep: () => Bun.sleep(5) },
    },
  })
  return { registry, processes, root, file }
}
