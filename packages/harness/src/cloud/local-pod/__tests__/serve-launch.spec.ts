import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  CHANNEL_PROTOCOL_VERSION,
  HEALTH_PROBE,
  SERVE_ALIVE_PROBE,
  SERVE_BINARY_PATH,
  SERVE_TOKEN_PATH,
} from '@dltech/atlas-wire'

import type { PodExecResult } from '../../../execution/docker/pod-engine'
import type { PodServeEngine } from '../serve-exec'
import type { PodServeInstaller } from '../serve-install'
import { createPodServeLauncher } from '../serve-launch'

type PodState = {
  alive: boolean
  aliveAfterStop: boolean
  tokenOnDisk: string | undefined
  stamps: { version: string; protocol: string }
  healthy: boolean
  healthyAfterLaunch: boolean
  binaryPresent: boolean
  logTail: string
}

const TOKEN = 'a'.repeat(64)
const CLOUD_URL = "https://cloud.example/it's"

const result = (args: { exitCode: number; stdout?: string }): PodExecResult => ({
  exitCode: args.exitCode,
  stdout: async () => args.stdout ?? '',
  stderr: async () => '',
})

const exit = (ok: boolean): PodExecResult => result({ exitCode: ok ? 0 : 1 })
const scenario = (overrides: Partial<PodState>) => {
  const state: PodState = {
    alive: false,
    aliveAfterStop: false,
    tokenOnDisk: undefined,
    stamps: { version: '', protocol: '' },
    healthy: false,
    healthyAfterLaunch: true,
    binaryPresent: true,
    logTail: '',
    ...overrides,
  }
  const events: string[] = []
  const scripts: string[] = []
  const writes: { path: string; content: Uint8Array | string; mode?: number | undefined }[] = []
  let launched = false
  let stopped = false

  const engine: PodServeEngine = {
    async execSh({ script }) {
      scripts.push(script)
      if (script === SERVE_ALIVE_PROBE) return exit(stopped ? state.aliveAfterStop : state.alive)
      if (script.includes('sha256sum < ')) {
        const digest = createHash('sha256')
          .update(state.tokenOnDisk ?? '')
          .digest('hex')
        const matches = state.tokenOnDisk === undefined || script.includes(`"${digest}"`)
        events.push('token-check')
        return exit(matches)
      }
      if (script.includes('atlas-serve.version')) {
        return result({
          exitCode: 0,
          stdout: `${state.stamps.version}\n${state.stamps.protocol}\n`,
        })
      }
      if (script === HEALTH_PROBE) return exit(launched ? state.healthyAfterLaunch : state.healthy)
      if (script.includes('seq 90')) {
        events.push('health-wait')
        return exit(launched ? state.healthyAfterLaunch : state.healthy)
      }
      if (script.includes('kill -9')) {
        events.push('stop')
        stopped = true
        return exit(true)
      }
      if (script === `test -s ${SERVE_BINARY_PATH}`) return exit(state.binaryPresent)
      if (script.includes('setsid nohup')) {
        events.push('launch')
        launched = true
        return exit(true)
      }
      if (script.startsWith('tail -c')) return result({ exitCode: 0, stdout: state.logTail })
      return exit(true)
    },
    async writeFile(write) {
      events.push(`write:${write.path}`)
      writes.push(write)
    },
  }

  const install: PodServeInstaller = async ({ version }) => {
    events.push(`install:${version ?? 'latest'}`)
    state.stamps = { version: version ?? 'latest', protocol: String(CHANNEL_PROTOCOL_VERSION) }
    state.binaryPresent = true
  }

  return { engine, install, events, scripts, writes }
}

const launch = (args: {
  fake: ReturnType<typeof scenario>
  desiredVersion?: string | undefined
  onSwapStarted?: () => void
  log?: (line: string) => void
}) =>
  createPodServeLauncher({ install: args.fake.install, log: args.log })({
    engine: args.fake.engine,
    id: 'pod-id',
    name: 'pod',
    token: TOKEN,
    cloudUrl: CLOUD_URL,
    desiredVersion: args.desiredVersion,
    onSwapStarted: args.onSwapStarted,
  })

describe('createPodServeLauncher', () => {
  it('keeps a live, current, healthy serve without touching it', async () => {
    const lines: string[] = []
    const fake = scenario({
      alive: true,
      tokenOnDisk: TOKEN,
      healthy: true,
      stamps: { version: '1.2.3', protocol: String(CHANNEL_PROTOCOL_VERSION) },
    })

    const outcome = await launch({ fake, desiredVersion: '1.2.3', log: (line) => lines.push(line) })

    expect(outcome).toEqual({})
    expect(fake.events).toEqual(['token-check'])
    expect(lines).toEqual(['pod pod has a live serve answering /v1/health — keeping it'])
  })

  it('refuses a live serve running under a different token', async () => {
    const fake = scenario({ alive: true, tokenOnDisk: 'b'.repeat(64), healthy: true })

    await expect(launch({ fake })).rejects.toThrow(/already running under a different token/)
    expect(fake.events).toEqual(['token-check'])
    expect(fake.writes).toHaveLength(0)
  })

  it('never puts the token in any exec argv', async () => {
    const fake = scenario({ alive: true, tokenOnDisk: TOKEN, healthy: true })

    await launch({ fake })
    const fresh = scenario({})
    await launch({ fake: fresh })
    expect([...fake.scripts, ...fresh.scripts].some((script) => script.includes(TOKEN))).toBe(false)
  })

  it('waits on a live but unhealthy serve and preserves it', async () => {
    const fake = scenario({
      alive: true,
      tokenOnDisk: TOKEN,
      healthy: false,
      healthyAfterLaunch: false,
      stamps: { version: '1.2.3', protocol: String(CHANNEL_PROTOCOL_VERSION) },
      logTail: 'boom: port in use\n',
    })

    await expect(launch({ fake, desiredVersion: '1.2.3' })).rejects.toThrow(
      /preserved rather than killed.*boom: port in use/s,
    )
    expect(fake.events).toEqual(['token-check', 'health-wait'])
  })

  it('treats an unreachable alive probe as alive', async () => {
    const fake = scenario({ tokenOnDisk: TOKEN, healthy: true })
    const engine: PodServeEngine = {
      async execSh(exec) {
        if (exec.script === SERVE_ALIVE_PROBE) throw new Error('exec timed out')
        return fake.engine.execSh(exec)
      },
      writeFile: fake.engine.writeFile,
    }

    const outcome = await createPodServeLauncher({ install: fake.install })({
      engine,
      id: 'pod-id',
      name: 'pod',
      token: TOKEN,
      cloudUrl: CLOUD_URL,
      desiredVersion: undefined,
    })

    expect(outcome).toEqual({})
    expect(fake.events).toEqual(['token-check'])
  })

  it('installs before stopping a drifted serve, signals the swap, and reports what it replaced', async () => {
    let swapSignalledAfter: string[] | undefined
    const fake = scenario({
      alive: true,
      tokenOnDisk: TOKEN,
      stamps: { version: '0.9.0', protocol: String(CHANNEL_PROTOCOL_VERSION - 1) },
    })

    const outcome = await launch({
      fake,
      desiredVersion: '1.2.3',
      onSwapStarted: () => {
        swapSignalledAfter = [...fake.events]
      },
    })

    expect(outcome).toEqual({
      swapped: { fromVersion: '0.9.0', fromProtocol: CHANNEL_PROTOCOL_VERSION - 1 },
    })
    expect(swapSignalledAfter).toEqual(['token-check', 'install:1.2.3'])
    expect(fake.events).toEqual([
      'token-check',
      'install:1.2.3',
      'stop',
      `write:${SERVE_TOKEN_PATH}`,
      'launch',
      'health-wait',
    ])
  })

  it('throws when the drifted serve refuses to stop', async () => {
    const fake = scenario({
      alive: true,
      aliveAfterStop: true,
      tokenOnDisk: TOKEN,
      stamps: { version: '0.9.0', protocol: String(CHANNEL_PROTOCOL_VERSION) },
    })

    await expect(launch({ fake, desiredVersion: '1.2.3' })).rejects.toThrow(/refused to stop/)
    expect(fake.events).not.toContain('launch')
  })

  it('on a fresh pod writes the token, installs, launches detached, then waits for health', async () => {
    const fake = scenario({ binaryPresent: false })

    const outcome = await launch({ fake, desiredVersion: '1.2.3' })

    expect(outcome).toEqual({ swapped: undefined })
    expect(fake.events).toEqual([
      `write:${SERVE_TOKEN_PATH}`,
      'install:1.2.3',
      'launch',
      'health-wait',
    ])
    const write = fake.writes[0]!
    expect(write.content).toBe(TOKEN)
    expect(write.mode).toBe(0o600)

    const launchScript = fake.scripts.find((script) => script.includes('setsid nohup'))!
    expect(
      launchScript.startsWith(`export ATLAS_CLOUD_URL='https://cloud.example/it'\\''s'; `),
    ).toBe(true)
    expect(launchScript).toContain('exec flock -n')
    expect(launchScript.endsWith('>/dev/null 2>&1 </dev/null &')).toBe(true)
  })

  it('treats the 0-byte image placeholder as absent', async () => {
    const fake = scenario({ binaryPresent: false, stamps: { version: '', protocol: '' } })

    await launch({ fake, desiredVersion: undefined })

    expect(fake.scripts).toContain(`test -s ${SERVE_BINARY_PATH}`)
    expect(fake.events).toContain('install:latest')
  })

  it('skips the install when the baked serve is present and current', async () => {
    const fake = scenario({
      binaryPresent: true,
      stamps: { version: '1.2.3', protocol: String(CHANNEL_PROTOCOL_VERSION) },
    })

    await launch({ fake, desiredVersion: '1.2.3' })

    expect(fake.events).toEqual([`write:${SERVE_TOKEN_PATH}`, 'launch', 'health-wait'])
  })

  it('keeps a serve that turns healthy after the token is written, and still reports the swap', async () => {
    const fake = scenario({ healthy: true })
    expect(await launch({ fake })).toEqual({ swapped: undefined })
    expect(fake.events).toEqual([`write:${SERVE_TOKEN_PATH}`])
  })

  it('fails with the serve log tail when the launched serve never turns healthy', async () => {
    const fake = scenario({
      binaryPresent: true,
      stamps: { version: '1.2.3', protocol: String(CHANNEL_PROTOCOL_VERSION) },
      healthyAfterLaunch: false,
      logTail: 'panic: listen EADDRINUSE\n',
    })

    await expect(launch({ fake, desiredVersion: '1.2.3' })).rejects.toThrow(
      /did not answer \/v1\/health within 180s.*panic: listen EADDRINUSE/s,
    )
  })

  it('reports an empty log tail plainly', async () => {
    const fake = scenario({
      stamps: { version: '1.2.3', protocol: String(CHANNEL_PROTOCOL_VERSION) },
      healthyAfterLaunch: false,
    })

    await expect(launch({ fake, desiredVersion: '1.2.3' })).rejects.toThrow(
      /serve log is empty or missing/,
    )
  })
})
