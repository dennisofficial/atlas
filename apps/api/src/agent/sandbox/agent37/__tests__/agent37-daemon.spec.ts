import { describe, expect, it } from 'bun:test'

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  Agent37Answer,
  Agent37Client,
  Agent37ExecArgs,
  Agent37Instance,
  Agent37Status,
} from '../agent37-client'
import {
  agent37BundleVersionOf,
  waitForAgent37Daemon,
  waitForAgent37Instance,
} from '../agent37-daemon'

const INSTANCE: Agent37Instance = {
  id: 'inst-1',
  status: 'running',
  url: 'https://inst-1.agent37.app',
}

const bundleOf = (
  content = '// daemon bundle\n',
): { path: string; version: string; cleanup: () => void } => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-agent37-bundle-'))
  const path = join(dir, 'daemon.js')
  writeFileSync(path, content)
  return {
    path,
    version: createHash('sha256').update(content).digest('hex'),
    cleanup: () => rmSync(dir, { recursive: true }),
  }
}

type ProbeArgs = {
  id: string
  port: number
  path?: string
  method?: 'GET' | 'POST'
  authorization?: string
}

const clientOf = (args: {
  versions: (probe: ProbeArgs) => Agent37Answer
  status?: () => Agent37Status
}): { client: Agent37Client; execs: Agent37ExecArgs[]; probes: ProbeArgs[] } => {
  const execs: Agent37ExecArgs[] = []
  const probes: ProbeArgs[] = []
  const client: Agent37Client = {
    create: async () => INSTANCE,
    get: async () => ({ ...INSTANCE, status: args.status?.() ?? 'running' }),
    list: async () => ({ data: [] }),
    remove: async () => undefined,
    sleep: async () => undefined,
    start: async ({ id }) => ({ id, status: 'running' }),
    resize: async ({ id }) => ({ ...INSTANCE, id }),
    exec: async (body) => {
      execs.push(body)
      return { exit_code: 0, stdout: '', stderr: '', truncated: false }
    },
    probe: async (probe) => {
      probes.push(probe)
      return args.versions(probe)
    },
    signedUrl: async () => 'https://inst-1-47300.agent37.app/?a37_token=t',
  }
  return { client, execs, probes }
}

describe('agent37BundleVersionOf', () => {
  it('hashes the bundle the api serves, which the sandbox boot loop recomputes', async () => {
    const bundle = bundleOf()
    try {
      expect(await agent37BundleVersionOf(bundle.path)).toBe(bundle.version)
    } finally {
      bundle.cleanup()
    }
  })
})

describe('waitForAgent37Instance', () => {
  it('waits for the running status without an exec', async () => {
    let calls = 0
    const { client, execs } = clientOf({
      versions: () => ({ status: 0, body: '' }),
      status: () => {
        calls += 1
        return calls < 2 ? 'starting' : 'running'
      },
    })
    await waitForAgent37Instance({ client, instanceId: 'inst-1', budgetMs: 10_000 })
    expect(execs).toHaveLength(0)
  })

  it('fails when the instance stops before it runs', async () => {
    const { client } = clientOf({
      versions: () => ({ status: 0, body: '' }),
      status: () => 'stopped',
    })
    await expect(
      waitForAgent37Instance({ client, instanceId: 'inst-1', budgetMs: 10_000 }),
    ).rejects.toThrow('last status "stopped"')
  })
})

describe('waitForAgent37Daemon', () => {
  it('returns once the port URL reports the bundle version, with no exec', async () => {
    const bundle = bundleOf()
    try {
      const { client, execs, probes } = clientOf({
        versions: () => ({ status: 200, body: `${bundle.version}\n` }),
      })
      await waitForAgent37Daemon({
        client,
        instanceId: 'inst-1',
        version: bundle.version,
        token: 'daemon-token',
        budgetMs: 10_000,
      })
      expect(execs).toHaveLength(0)
      expect(probes).toEqual([{ id: 'inst-1', port: 47300, path: '/version' }])
    } finally {
      bundle.cleanup()
    }
  })

  it('asks a mismatched daemon to restart and waits for the new version', async () => {
    const bundle = bundleOf()
    try {
      let restarted = false
      const { client, execs, probes } = clientOf({
        versions: (probe) => {
          if (probe.method === 'POST') {
            restarted = true
            return { status: 202, body: 'restarting' }
          }
          return restarted
            ? { status: 200, body: bundle.version }
            : { status: 200, body: 'atlas-daemon' }
        },
      })
      await waitForAgent37Daemon({
        client,
        instanceId: 'inst-1',
        version: bundle.version,
        token: 'daemon-token',
        budgetMs: 10_000,
      })
      expect(execs).toHaveLength(0)
      expect(probes[1]).toEqual({
        id: 'inst-1',
        port: 47300,
        path: '/restart',
        method: 'POST',
        authorization: 'Bearer daemon-token',
      })
    } finally {
      bundle.cleanup()
    }
  })

  it('fails with the version it last saw when the daemon never catches up', async () => {
    const { client } = clientOf({ versions: () => ({ status: 200, body: 'atlas-daemon' }) })
    await expect(
      waitForAgent37Daemon({
        client,
        instanceId: 'inst-1',
        version: 'expected',
        token: 'daemon-token',
        budgetMs: 250,
      }),
    ).rejects.toThrow('last version "atlas-daemon"')
  })
})
