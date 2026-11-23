import { describe, expect, it } from 'bun:test'

import type { Agent37Answer, Agent37Client, Agent37Instance } from '../agent37-client'
import {
  daemonSkewOf,
  EDaemonSkew,
  pinnedDaemonBundleUrlOf,
  waitForAgent37Daemon,
} from '../agent37-daemon'

const INSTANCE: Agent37Instance = {
  id: 'inst-1',
  status: 'running',
  url: 'https://inst-1.agent37.app',
}

type ProbeArgs = {
  id: string
  port: number
  path?: string
  method?: 'GET' | 'POST'
  authorization?: string
  body?: string
}

type DaemonBuild = { version: string; protocol: number; minProtocol: number }

type HostGeneration = DaemonBuild & { url: string }

const generationOf = (build: DaemonBuild): HostGeneration => ({
  ...build,
  url: `https://api.byatlas.io/agent/daemon/bundle?version=${build.version}`,
})

const versionOfUrl = (url: string): string | undefined =>
  new URL(url).searchParams.get('version') ?? undefined

// The sandbox image's boot loop, as the deploy makes it behave: a pinned url is only answered by a
// generation that holds that exact bundle, and the pin survives until the next restart asks for one.
const daemonOf = (args: {
  initial: DaemonBuild
  generations: readonly HostGeneration[]
}): { client: Agent37Client; builds: DaemonBuild[]; restarts: () => ProbeArgs[] } => {
  let running = args.initial
  let pin: string | undefined
  const restarts: ProbeArgs[] = []
  const builds: DaemonBuild[] = [args.initial]
  const reboot = (): void => {
    const wanted = pin === undefined ? undefined : versionOfUrl(pin)
    const served =
      wanted === undefined
        ? args.generations[0]
        : args.generations.find((generation) => generation.version === wanted)
    if (served === undefined) return
    running = {
      version: served.version,
      protocol: served.protocol,
      minProtocol: served.minProtocol,
    }
    builds.push(running)
  }
  const client: Agent37Client = {
    create: async () => INSTANCE,
    get: async () => INSTANCE,
    list: async () => ({ data: [] }),
    remove: async () => undefined,
    sleep: async () => undefined,
    start: async ({ id }) => ({ id, status: 'running' }),
    resize: async ({ id }) => ({ ...INSTANCE, id }),
    update: async ({ id }) => ({ id, status: 'updating' }),
    logs: async () => ({
      logs: '',
      truncated: false,
      health: { running: true, restart_count: 0, exit_code: null, oom_suspected: false },
      fetched_at: 0,
    }),
    exec: async () => ({ exit_code: 0, stdout: '', stderr: '', truncated: false }),
    probe: async (probe) => {
      if (probe.method === 'POST' && probe.path === '/restart') {
        restarts.push(probe)
        const body: unknown = JSON.parse(probe.body ?? '{}')
        pin =
          typeof body === 'object' && body !== null && 'bundleUrl' in body
            ? String(body.bundleUrl)
            : undefined
        reboot()
        return { status: 202, body: 'restarting' }
      }
      return {
        status: 200,
        body: running.version,
        headers: {
          'x-atlas-daemon-protocol': String(running.protocol),
          'x-atlas-daemon-min-protocol': String(running.minProtocol),
        },
      } satisfies Agent37Answer
    },
    signedUrl: async () => 'https://inst-1-47300.agent37.app/?a37_token=t',
    usage: async () => ({ from: '', to: '' }),
    metrics: async () => ({
      series: {},
      limits: { cpu_cores: 0, memory_bytes: 0, disk_bytes: 0 },
      hours: 1,
      step_seconds: 60,
      fetched_at: 0,
    }),
    events: async () => ({ from: '', to: '', events: [] }),
  }
  return { client, builds, restarts: () => restarts }
}

const wake = (args: { client: Agent37Client; generation: HostGeneration }): Promise<void> =>
  waitForAgent37Daemon({
    client: args.client,
    instanceId: 'inst-1',
    want: {
      version: args.generation.version,
      url: args.generation.url,
      protocol: args.generation.protocol,
      minProtocol: args.generation.minProtocol,
    },
    token: 'daemon-token',
    budgetMs: 5_000,
  })

describe('daemonSkewOf', () => {
  const want = {
    version: 'new',
    url: 'https://api/agent/daemon/bundle',
    protocol: 31,
    minProtocol: 30,
  }

  it('serves the same bundle whatever protocol it reports', () => {
    expect(
      daemonSkewOf({
        report: { version: 'new', protocol: undefined, minProtocol: undefined },
        want,
      }),
    ).toBe(EDaemonSkew.Compatible)
  })

  it('keeps a daemon whose protocol range overlaps this host', () => {
    expect(daemonSkewOf({ report: { version: 'old', protocol: 30, minProtocol: 29 }, want })).toBe(
      EDaemonSkew.Compatible,
    )
  })

  it('restarts a daemon too old for this host, and one that reports no protocol at all', () => {
    expect(daemonSkewOf({ report: { version: 'old', protocol: 29, minProtocol: 28 }, want })).toBe(
      EDaemonSkew.Restart,
    )
    expect(
      daemonSkewOf({
        report: { version: 'old', protocol: undefined, minProtocol: undefined },
        want,
      }),
    ).toBe(EDaemonSkew.Restart)
  })

  it('never downgrades a daemon newer than this host', () => {
    expect(
      daemonSkewOf({ report: { version: 'newer', protocol: 32, minProtocol: 32 }, want }),
    ).toBe(EDaemonSkew.HostTooOld)
  })
})

describe('two host generations waking one daemon', () => {
  const older = generationOf({ version: 'a'.repeat(64), protocol: 30, minProtocol: 29 })
  const newer = generationOf({ version: 'b'.repeat(64), protocol: 31, minProtocol: 30 })
  const strayed = generationOf({ version: 'c'.repeat(64), protocol: 29, minProtocol: 29 })
  const preFix = { version: 'pre-fix', protocol: 28, minProtocol: 28 }

  it('converges on the newer bundle and then stops restarting it', async () => {
    const daemon = daemonOf({ initial: preFix, generations: [older, newer] })

    await wake({ client: daemon.client, generation: newer })
    expect(daemon.builds.at(-1)?.version).toBe(newer.version)
    const restarts = daemon.restarts().length
    expect(restarts).toBe(1)

    for (const generation of [older, newer, older, newer, older, newer]) {
      await wake({ client: daemon.client, generation })
    }
    expect(daemon.restarts()).toHaveLength(restarts)
    expect(daemon.builds.at(-1)?.version).toBe(newer.version)
  })

  it('pins the restart to the requester own bundle, never whichever generation answers', async () => {
    const daemon = daemonOf({ initial: preFix, generations: [older, newer] })

    await wake({ client: daemon.client, generation: newer })

    expect(daemon.restarts()).toHaveLength(1)
    const body: unknown = JSON.parse(daemon.restarts()[0]?.body ?? '{}')
    expect(body).toEqual({ bundleUrl: newer.url, bundleVersion: newer.version })
  })

  it('reports a daemon newer than this host instead of fighting it', async () => {
    const daemon = daemonOf({ initial: preFix, generations: [strayed, newer] })
    await wake({ client: daemon.client, generation: newer })

    await expect(wake({ client: daemon.client, generation: strayed })).rejects.toThrow(
      'newer than this host speaks',
    )
    expect(daemon.restarts()).toHaveLength(1)
    expect(daemon.builds.at(-1)?.version).toBe(newer.version)
  })
})

describe('pinnedDaemonBundleUrlOf', () => {
  it('names the bundle on a url that may already carry a query', () => {
    expect(pinnedDaemonBundleUrlOf({ url: 'https://api/agent/daemon/bundle', version: 'ab' })).toBe(
      'https://api/agent/daemon/bundle?version=ab',
    )
    expect(pinnedDaemonBundleUrlOf({ url: 'https://api/b?tenant=1', version: 'ab' })).toBe(
      'https://api/b?tenant=1&version=ab',
    )
  })
})

describe('a daemon that never reports a version', () => {
  it('fails with the last version it saw', async () => {
    const client: Agent37Client = {
      create: async () => INSTANCE,
      get: async () => INSTANCE,
      list: async () => ({ data: [] }),
      remove: async () => undefined,
      sleep: async () => undefined,
      start: async ({ id }) => ({ id, status: 'running' }),
      resize: async ({ id }) => ({ ...INSTANCE, id }),
      update: async ({ id }) => ({ id, status: 'updating' }),
      logs: async () => ({
        logs: '',
        truncated: false,
        health: { running: true, restart_count: 0, exit_code: null, oom_suspected: false },
        fetched_at: 0,
      }),
      exec: async () => ({ exit_code: 0, stdout: '', stderr: '', truncated: false }),
      probe: async () => ({ status: 0, body: '' }),
      signedUrl: async () => 'https://inst-1-47300.agent37.app/?a37_token=t',
      usage: async () => ({ from: '', to: '' }),
      metrics: async () => ({
        series: {},
        limits: { cpu_cores: 0, memory_bytes: 0, disk_bytes: 0 },
        hours: 1,
        step_seconds: 60,
        fetched_at: 0,
      }),
      events: async () => ({ from: '', to: '', events: [] }),
    }
    await expect(
      waitForAgent37Daemon({
        client,
        instanceId: 'inst-1',
        want: { version: 'expected', url: 'https://api/agent/daemon/bundle?version=expected' },
        token: 'daemon-token',
        budgetMs: 200,
      }),
    ).rejects.toThrow('last version "none"')
  })
})
