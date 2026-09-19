import { afterEach, describe, expect, it } from 'bun:test'

import { get } from 'node:http'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EXPOSURE_HOST_SUFFIX, exposureUrlFor } from '@dltech/atlas-core'

import { DockerProcessPort } from '../docker-process'
import { DockerEngine } from '../engine'
import { PROXY_CONTAINER_PORT } from '../expose-proxy'
import { dockerUnavailableReason } from './live-docker'
import { derivedHostPort, hostPortFor } from '../ports'
import {
  DEFAULT_SANDBOX_IMAGE,
  sandboxCreateBody,
  sandboxNetworkNameFor,
  worktreeLabel,
  type SandboxConfig,
} from '../sandbox'

const WORKTREE = '/Users/operator/Developer/project/.atlas/worktrees/feature'
const PREFIX = 'atlas-dev-ports'

describe('derivedHostPort', () => {
  it('is a pure function of the session key and the container port', () => {
    const first = derivedHostPort({ session: WORKTREE, containerPort: 3000 })

    expect(first).toBe(derivedHostPort({ session: WORKTREE, containerPort: 3000 }))
    expect(first).toBeGreaterThanOrEqual(20_000)
    expect(first).toBeLessThan(49_152)
  })

  it('gives two sessions different host ports for the same container port', () => {
    const one = derivedHostPort({ session: '/work/one', containerPort: 3000 })
    const two = derivedHostPort({ session: '/work/two', containerPort: 3000 })

    expect(one).not.toBe(two)
  })
})

describe('hostPortFor', () => {
  it('uses the derived host port while it is free', () => {
    expect(hostPortFor({ session: WORKTREE, containerPort: PROXY_CONTAINER_PORT })).toBe(
      derivedHostPort({ session: WORKTREE, containerPort: PROXY_CONTAINER_PORT }),
    )
  })

  it('falls back to an ephemeral host port when the derived one is taken', () => {
    const session = '/work/taken-fallback'
    const derived = derivedHostPort({ session, containerPort: PROXY_CONTAINER_PORT })
    const occupant = Bun.listen({
      hostname: '127.0.0.1',
      port: derived,
      socket: { data() {} },
    })

    try {
      const hostPort = hostPortFor({ session, containerPort: PROXY_CONTAINER_PORT })

      expect(hostPort).not.toBe(derived)

      const probe = Bun.listen({ hostname: '127.0.0.1', port: hostPort, socket: { data() {} } })
      probe.stop(true)
    } finally {
      occupant.stop(true)
    }
  })
})

describe('sandboxCreateBody networking', () => {
  const config: SandboxConfig = {
    image: DEFAULT_SANDBOX_IMAGE,
    worktree: WORKTREE,
    session: WORKTREE,
    uid: 501,
    gid: 20,
    home: '/Users/operator',
    limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
    dockerSocket: '/var/run/docker.sock',
  }

  it('publishes no ports: exposure goes through the proxy, which joins the sandbox network', () => {
    const body = sandboxCreateBody(config)

    expect(body.ExposedPorts).toBeUndefined()
    expect(body.HostConfig?.PortBindings).toBeUndefined()
  })

  it('attaches the sandbox to its per-session network', () => {
    const body = sandboxCreateBody(config)

    expect(Object.keys(body.NetworkingConfig?.EndpointsConfig ?? {})).toEqual([
      sandboxNetworkNameFor({ prefix: 'atlas', session: WORKTREE }),
    ])
  })
})

const SOCKET = '/var/run/docker.sock'
const describeDocker = (await dockerUnavailableReason(SOCKET)) === undefined ? describe : describe.skip
const engine = new DockerEngine({ socketPath: SOCKET })

const sweep = async (): Promise<void> => {
  const stale = await engine.listContainers({
    labels: { [worktreeLabel(PREFIX)]: undefined },
    all: true,
  })
  for (const container of stale) await engine.removeContainer({ id: container.id })
  const networks = await engine.listNetworks({ labels: { [worktreeLabel(PREFIX)]: undefined } })
  for (const network of networks) await engine.removeNetwork({ id: network.id }).catch(() => undefined)
}

const fetchViaProxy = (args: { hostPort: number; host: string }): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const request = get(
      {
        host: '127.0.0.1',
        port: args.hostPort,
        path: '/',
        headers: { host: args.host },
      },
      (response) => {
        let body = ''
        response.on('data', (chunk) => (body += chunk))
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
      },
    )
    request.on('error', reject)
    request.setTimeout(10_000, () => request.destroy(new Error('timed out')))
  })

describeDocker('the expose proxy against a live daemon', () => {
  afterEach(sweep)

  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  const configFor = (root: string): SandboxConfig => ({
    image: DEFAULT_SANDBOX_IMAGE,
    worktree: root,
    session: root,
    uid: process.getuid?.() ?? 501,
    gid: process.getgid?.() ?? 20,
    home: '/Users/operator',
    limits: { cpus: 1, memoryBytes: 512 * 1024 ** 2 },
    dockerSocket: SOCKET,
    labelPrefix: PREFIX,
  })

  const openPort = async (args: { containerPort?: number; root?: string } = {}) => {
    const root = args.root ?? (await realpath(await mkdtemp(join(tmpdir(), 'atlas-ports-'))))
    roots.push(root)
    const processes = new DockerProcessPort({
      engine,
      sandbox: configFor(root),
      dockerCli: null,
    })
    return {
      root,
      outcome: await processes.exposePort({ containerPort: args.containerPort ?? 3000 }),
    }
  }

  it('gives two sandboxes different proxy host ports, and the URL carries the container port in the hostname', async () => {
    const one = await openPort()
    const two = await openPort()
    if (!one.outcome.ok) throw new Error(one.outcome.reason)
    if (!two.outcome.ok) throw new Error(two.outcome.reason)

    expect(one.outcome.exposure.hostPort).not.toBe(two.outcome.exposure.hostPort)
    expect(one.outcome.exposure.url).toBe(
      exposureUrlFor({ containerPort: 3000, hostPort: one.outcome.exposure.hostPort }),
    )
    expect(one.outcome.exposure.url).toContain(`3000${EXPOSURE_HOST_SUFFIX}`)
  }, 120_000)

  it('exposes ports far outside the old 3000-3003 block without complaint', async () => {
    const { outcome } = await openPort({ containerPort: 8080 })
    if (!outcome.ok) throw new Error(outcome.reason)

    expect(outcome.exposure.containerPort).toBe(8080)
    expect(outcome.exposure.url).toContain(`8080${EXPOSURE_HOST_SUFFIX}`)
  }, 120_000)

  it('keeps the same host port across a sandbox stop and start', async () => {
    const first = await openPort()
    if (!first.outcome.ok) throw new Error(first.outcome.reason)

    const found = await engine.listContainers({
      labels: { [worktreeLabel(PREFIX)]: first.root },
      all: true,
    })
    const sandbox = found.find((one) => !one.name.includes('-proxy-'))
    await engine.stopContainer({ id: sandbox?.id ?? '' })

    const again = await openPort({ root: first.root })
    if (!again.outcome.ok) throw new Error(again.outcome.reason)

    expect(again.outcome.exposure.hostPort).toBe(first.outcome.exposure.hostPort)
  }, 120_000)

  it('proxies a request from the host to a server on any sandbox port', async () => {
    const { root, outcome } = await openPort({ containerPort: 5173 })
    if (!outcome.ok) throw new Error(outcome.reason)

    const found = await engine.listContainers({ labels: { [worktreeLabel(PREFIX)]: root } })
    const sandbox = found.find((one) => !one.name.includes('-proxy-'))
    const exec = await engine.createExec({
      containerId: sandbox?.id ?? '',
      cmd: [
        'node',
        '-e',
        "require('http').createServer((req, res) => res.end('hello-from-sandbox')).listen(5173, '0.0.0.0')",
      ],
      cwd: '/',
      env: {},
    })
    await engine.startExec({ execId: exec.id, detach: true })

    let body = ''
    for (let attempt = 0; attempt < 100 && body === ''; attempt += 1) {
      body = await fetchViaProxy({
        hostPort: outcome.exposure.hostPort,
        host: `5173${EXPOSURE_HOST_SUFFIX}`,
      })
        .then((response) => (response.status === 200 ? response.body : ''))
        .catch(() => '')
      if (body === '') await Bun.sleep(100)
    }

    expect(body).toBe('hello-from-sandbox')
  }, 120_000)

  it('answers the info page to a bare host and 502s a port with nothing listening', async () => {
    const { outcome } = await openPort()
    if (!outcome.ok) throw new Error(outcome.reason)

    let info = { status: 0, body: '' }
    for (let attempt = 0; attempt < 100 && info.status === 0; attempt += 1) {
      info = await fetchViaProxy({ hostPort: outcome.exposure.hostPort, host: 'sandbox.localhost' }).catch(
        () => ({ status: 0, body: '' }),
      )
      if (info.status === 0) await Bun.sleep(100)
    }
    expect(info.status).toBe(200)
    expect(info.body).toContain(`<port>${EXPOSURE_HOST_SUFFIX}`)

    const refused = await fetchViaProxy({
      hostPort: outcome.exposure.hostPort,
      host: `9${EXPOSURE_HOST_SUFFIX}`,
    })
    expect(refused.status).toBe(502)
    expect(refused.body).toContain('port 9')
  }, 120_000)
})
