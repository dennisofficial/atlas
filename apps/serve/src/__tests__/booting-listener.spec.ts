import { afterEach, describe, expect, it } from 'bun:test'

import { EServeFrame } from '@dltech/atlas-harness'
import { EServeEvent, EWorkspaceState, startServe, type ServeHandle } from '../index'

import { connect } from './client'
import { fakeServeApp } from './fakes'
import { CONTROL_PLANE, hello, inMemoryContextFiles, releaseServeSpec, threadId, TOKEN } from './serve-spec-fixture'

const GUARDED_FIELDS = [
  'busy',
  'childrenRunning',
  'shellsRunning',
  'servicesRunning',
  'pendingInput',
  'settlingWork',
  'clients',
] as const

type BootingProbe = {
  port: Promise<number>
  handle: Promise<ServeHandle>
  lines: string[]
  openGate: () => void
}

const probes: BootingProbe[] = []

const gateOf = (): { opened: Promise<void>; open: () => void } => {
  let open = (): void => undefined
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open: () => open() }
}

const listeningPort = async (lines: string[]): Promise<number> => {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    for (const line of lines) {
      if (!line.includes(EServeEvent.Listening)) continue
      const parsed = JSON.parse(line) as { port?: unknown }
      if (typeof parsed.port === 'number') return parsed.port
    }
    await Bun.sleep(5)
  }
  throw new Error('the serve never logged that it is listening')
}

const bootingServe = (args: { gateOpen?: boolean | undefined } = {}): BootingProbe => {
  const gate = gateOf()
  const lines: string[] = []
  const handle = startServe({
    threadId,
    port: 0,
    token: TOKEN,
    controlPlaneUrl: CONTROL_PLANE,
    env: {},
    cwd: '/workspace',
    write: (line) => lines.push(line),
    compose: async () => fakeServeApp({ threadId, root: '/workspace' }),
    ensureWorkspace: async () => {
      await gate.opened
      return { state: EWorkspaceState.Skipped }
    },
    contextFiles: inMemoryContextFiles(),
  })
  const probe: BootingProbe = {
    port: listeningPort(lines),
    handle,
    lines,
    openGate: gate.open,
  }
  if (args.gateOpen === true) gate.open()
  probes.push(probe)
  return probe
}

const fetchHealth = async (port: number): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  })
  return { status: response.status, body: await response.json() }
}

const postWithReason = async (args: { port: number; path: string }): Promise<Response> =>
  fetch(`http://127.0.0.1:${args.port}${args.path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'spec' }),
  })

afterEach(async () => {
  while (probes.length > 0) {
    const probe = probes.pop()
    probe?.openGate()
    const handle = await probe?.handle.catch(() => undefined)
    await handle?.close()
  }
  await releaseServeSpec()
})

describe('booting health listener', () => {
  it('answers /v1/health with booting: true and every guarded field while the workspace is still materializing', async () => {
    const probe = bootingServe()
    const port = await probe.port

    const before = await fetchHealth(port)
    expect(before.status).toBe(200)
    expect(before.body).toMatchObject({ ok: true, booting: true, threadId: String(threadId) })

    probe.openGate()
    await probe.handle
    const after = await fetchHealth(port)
    const body = after.body as Record<string, unknown>
    for (const field of GUARDED_FIELDS) {
      expect(body[field]).not.toBeUndefined()
    }
  })

  it('accepts an authorized /v1/session upgrade while booting, then greets once boot completes', async () => {
    const probe = bootingServe()
    const port = await probe.port

    const client = await connect({ port, token: TOKEN })
    client.send(hello({ channelCursor: null, lastEventSeq: 0 }))
    expect(client.frames.some((frame) => frame.kind === EServeFrame.Ready)).toBe(false)

    probe.openGate()
    await probe.handle
    await client.waitFor((frame) => frame.kind === EServeFrame.Ready)
    client.close()
  })

  it('503s /v1/park and /v1/drain while booting', async () => {
    const probe = bootingServe()
    const port = await probe.port

    const park = await postWithReason({ port, path: '/v1/park' })
    expect(park.status).toBe(503)
    const drain = await postWithReason({ port, path: '/v1/drain' })
    expect(drain.status).toBe(503)
  })

  it('reports the real workspace and work state, without booting, once boot completes', async () => {
    const probe = bootingServe()
    const port = await probe.port
    probe.openGate()
    await probe.handle

    const after = await fetchHealth(port)
    expect(after.status).toBe(200)
    const body = after.body as Record<string, unknown>
    expect(body['booting']).toBeUndefined()
    expect(after.body).toMatchObject({
      ok: true,
      threadId: String(threadId),
      admissionClosed: false,
      workspace: { state: EWorkspaceState.Skipped },
    })
  })

  it('keeps every guarded field present across the booting-to-ready transition', async () => {
    const probe = bootingServe()
    const port = await probe.port

    const booting = await fetchHealth(port)
    probe.openGate()
    await probe.handle
    const ready = await fetchHealth(port)

    for (const fetched of [booting, ready]) {
      const body = fetched.body as Record<string, unknown>
      for (const field of GUARDED_FIELDS) {
        expect(body[field]).not.toBeUndefined()
      }
    }
  })

  it('logs when it starts listening and when it becomes ready, ready last', async () => {
    const probe = bootingServe()
    await probe.port
    probe.openGate()
    await probe.handle

    const listeningAt = probe.lines.findIndex((line) => line.includes(EServeEvent.Listening))
    const startedAt = probe.lines.findIndex((line) => line.includes(EServeEvent.Started))
    expect(listeningAt).toBeGreaterThanOrEqual(0)
    expect(startedAt).toBeGreaterThanOrEqual(0)
    expect(listeningAt).toBeLessThan(startedAt)
  })
})
