import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ESandboxProvider } from '@dltech/atlas-protocol'

import { EPodStart } from '../../sandbox-provider'
import type { Agent37Client, Agent37Status } from '../agent37-client'
import { agent37BundleVersionOf } from '../agent37-daemon'
import { Agent37SandboxProvider } from '../agent37-sandbox-provider'

const unused = async (): Promise<never> => {
  throw new Error('unused')
}

const wakeOf = async (args: { sleeping: boolean; restart?: boolean }) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-agent37-stages-'))
  const path = join(dir, 'daemon.js')
  writeFileSync(path, 'daemon')
  try {
    const version = await agent37BundleVersionOf(path)
    const time = { now: 100 }
    let status: Agent37Status = args.sleeping ? 'sleeping' : 'running'
    let restarted = false
    const client: Agent37Client = {
      create: unused,
      list: unused,
      remove: unused,
      sleep: unused,
      resize: unused,
      update: unused,
      edit: unused,
      exec: unused,
      usage: unused,
      metrics: unused,
      events: unused,
      get: async ({ id }) => {
        time.now += 20
        return { id, status, url: `https://${id}.agent37.app` }
      },
      start: async ({ id }) => {
        time.now += 300
        status = 'running'
        return { id, status }
      },
      logs: async () => {
        time.now += 40
        return {
          logs: '',
          truncated: false,
          health: { running: true, restart_count: 0, exit_code: null, oom_suspected: false },
          fetched_at: 0,
        }
      },
      probe: async ({ path }) => {
        if (path === '/restart') {
          time.now += 25
          restarted = true
          return { status: 202, body: '' }
        }
        time.now += 500
        return { status: 200, body: args.restart && !restarted ? 'old' : version }
      },
      signedUrl: async () => {
        time.now += 90
        return 'https://inst-1-47300.agent37.app'
      },
    }
    const provider = new Agent37SandboxProvider({
      env: { apiKey: 'test', template: 'atlas', resources: { cpu: 2, memory: 4, disk: 20 } },
      daemonBundle: { path },
      daemonBundleUrl: 'https://api.example/bundle',
      daemonSecret: 'test',
      client,
      monotonicNow: () => time.now,
      instances: {
        find: async () => 'inst-1',
        remember: async () => undefined,
        forget: async () => undefined,
        seedStatus: async () => undefined,
      },
    })
    return await provider.wake({
      target: {
        sandboxSessionId: 'pod-1',
        credentials: { provider: ESandboxProvider.Agent37, apiKey: 'test' },
      },
      signal: new AbortController().signal,
    })
  } finally {
    rmSync(dir, { recursive: true })
  }
}

describe('Agent37 wake stage timings', () => {
  it('measures start until running separately from the daemon readiness probe', async () => {
    const endpoint = await wakeOf({ sleeping: true })
    expect(endpoint.start).toBe(EPodStart.Woke)
    expect(endpoint.stages).toEqual({ instanceStartMs: 320, daemonReadyMs: 500 })
  })

  it('reports zero start time when running and includes the lifecycle health check in daemon readiness', async () => {
    const endpoint = await wakeOf({ sleeping: false })
    expect(endpoint.start).toBe(EPodStart.Running)
    expect(endpoint.stages).toEqual({ instanceStartMs: 0, daemonReadyMs: 540 })
  })

  it('includes a daemon restart and its next compatible version probe', async () => {
    const endpoint = await wakeOf({ sleeping: true, restart: true })
    expect(endpoint.stages).toEqual({ instanceStartMs: 320, daemonReadyMs: 1_025 })
  })
})
