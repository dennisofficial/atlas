import { afterEach, describe, expect, it } from 'bun:test'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EngineRequestFailed } from '../engine-http'
import { DockerPodEngine } from '../pod-engine'

type RecordedRequest = {
  method: string
  path: string
  query: Record<string, string>
  contentType: string | null
  text: string
  bytes: Uint8Array
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function serveDaemon(handler: Handler) {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-pod-engine-'))
  const socketPath = join(directory, 'docker.sock')
  const requests: RecordedRequest[] = []
  const server = Bun.serve({
    unix: socketPath,
    async fetch(incoming) {
      const url = new URL(incoming.url)
      const bytes = new Uint8Array(await incoming.arrayBuffer())
      const recorded = {
        method: incoming.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        contentType: incoming.headers.get('content-type'),
        text: new TextDecoder().decode(bytes),
        bytes,
      }
      requests.push(recorded)
      return await handler(recorded)
    },
  })
  cleanups.push(async () => {
    await server.stop(true)
    await rm(directory, { recursive: true, force: true })
  })
  return { engine: new DockerPodEngine({ socketPath }), requests }
}

const frame = (args: { stream: 1 | 2; text: string }): Uint8Array => {
  const payload = new TextEncoder().encode(args.text)
  const bytes = new Uint8Array(8 + payload.length)
  bytes[0] = args.stream
  new DataView(bytes.buffer).setUint32(4, payload.length, false)
  bytes.set(payload, 8)
  return bytes
}

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

const octal = (field: Uint8Array): number => parseInt(new TextDecoder().decode(field).replace(/\0.*$/, '').trim(), 8)

const firstTarEntry = (archive: Uint8Array) => {
  const text = (start: number, end: number) =>
    new TextDecoder().decode(archive.slice(start, end)).replace(/\0.*$/, '')
  const size = octal(archive.slice(124, 136))
  return {
    name: text(0, 100),
    mode: octal(archive.slice(100, 108)),
    typeflag: text(156, 157),
    body: archive.slice(512, 512 + size),
  }
}

describe('DockerPodEngine request shapes', () => {
  it('updates container resources', async () => {
    const { engine, requests } = await serveDaemon(() => Response.json({ Warnings: [] }))

    await engine.updateContainer({
      id: 'abc',
      resources: { nanoCpus: 1_000_000_000, memoryReservationBytes: 268_435_456 },
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: 'POST', path: '/containers/abc/update', query: {} })
    expect(JSON.parse(requests[0]?.text ?? '')).toEqual({
      NanoCpus: 1_000_000_000,
      MemoryReservation: 268_435_456,
    })
  })

  it('creates a labelled volume', async () => {
    const { engine, requests } = await serveDaemon(() => Response.json({ Name: 'vol' }, { status: 201 }))

    await engine.createVolume({ name: 'vol', labels: { team: 'pods' } })

    expect(requests[0]).toMatchObject({ method: 'POST', path: '/volumes/create' })
    expect(JSON.parse(requests[0]?.text ?? '')).toEqual({ Name: 'vol', Labels: { team: 'pods' } })
  })

  it('lists volumes with an encoded label filter', async () => {
    const { engine, requests } = await serveDaemon(() =>
      Response.json({
        Volumes: [
          { Name: 'one', Labels: { team: 'pods', n: 1 } },
          { Name: 'two', Labels: null },
        ],
        Warnings: null,
      }),
    )

    const volumes = await engine.listVolumes({ labels: { team: 'pods', bare: undefined } })

    expect(requests[0]).toMatchObject({ method: 'GET', path: '/volumes' })
    expect(JSON.parse(requests[0]?.query.filters ?? '')).toEqual({ label: ['team=pods', 'bare'] })
    expect(volumes).toEqual([
      { name: 'one', labels: { team: 'pods' } },
      { name: 'two', labels: {} },
    ])
  })

  it('lists no volumes when the daemon answers a null array', async () => {
    const { engine } = await serveDaemon(() => Response.json({ Volumes: null, Warnings: null }))

    expect(await engine.listVolumes({ labels: { team: 'pods' } })).toEqual([])
  })

  it('removes a volume and treats a missing one as removed', async () => {
    const { engine, requests } = await serveDaemon(() =>
      Response.json({ message: 'get vol: no such volume' }, { status: 404 }),
    )

    await engine.removeVolume({ name: 'vol' })

    expect(requests[0]).toMatchObject({ method: 'DELETE', path: '/volumes/vol' })
  })

  it('rejects when removing a volume fails for any other reason', async () => {
    const { engine } = await serveDaemon(() =>
      Response.json({ message: 'volume is in use' }, { status: 500 }),
    )

    const failure = await engine.removeVolume({ name: 'vol' }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(EngineRequestFailed)
    expect((failure as EngineRequestFailed).status).toBe(500)
  })
})

describe('DockerPodEngine writeFile', () => {
  it('puts a one-entry tar into the parent directory', async () => {
    const { engine, requests } = await serveDaemon(() => new Response(null, { status: 200 }))

    await engine.writeFile({ id: 'abc', path: '/data/sub/hello.txt', content: 'héllo' })

    expect(requests[0]).toMatchObject({
      method: 'PUT',
      path: '/containers/abc/archive',
      query: { path: '/data/sub' },
      contentType: 'application/x-tar',
    })
    const entry = firstTarEntry(requests[0]?.bytes ?? new Uint8Array())
    expect(entry.name).toBe('hello.txt')
    expect(entry.typeflag).toBe('0')
    expect(entry.mode).toBe(0o600)
    expect(new TextDecoder().decode(entry.body)).toBe('héllo')
  })

  it('carries binary content and an explicit mode', async () => {
    const { engine, requests } = await serveDaemon(() => new Response(null, { status: 200 }))
    const content = Uint8Array.from([0, 255, 1, 254])

    await engine.writeFile({ id: 'abc', path: '/run/key', content, mode: 0o400 })

    const entry = firstTarEntry(requests[0]?.bytes ?? new Uint8Array())
    expect(requests[0]?.query.path).toBe('/run')
    expect(entry.mode).toBe(0o400)
    expect(Array.from(entry.body)).toEqual([0, 255, 1, 254])
  })

  it('lets a missing parent directory surface as an engine failure', async () => {
    const { engine } = await serveDaemon(() =>
      Response.json({ message: 'Could not find the file /nope in container abc' }, { status: 404 }),
    )

    const failure = await engine
      .writeFile({ id: 'abc', path: '/nope/file', content: 'x' })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(EngineRequestFailed)
    expect((failure as EngineRequestFailed).status).toBe(404)
  })
})

describe('DockerPodEngine execSh', () => {
  it('collects both streams and the exit code', async () => {
    const { engine, requests } = await serveDaemon((request) => {
      if (request.path === '/containers/abc/exec') return Response.json({ Id: 'exec-1' }, { status: 201 })
      if (request.path === '/exec/exec-1/start') {
        return new Response(
          concat([
            frame({ stream: 1, text: 'out-1 ' }),
            frame({ stream: 2, text: 'err-1' }),
            frame({ stream: 1, text: 'out-2' }),
          ]),
        )
      }
      return Response.json({ Running: false, ExitCode: 3 })
    })

    const result = await engine.execSh({ id: 'abc', script: 'echo hi; exit 3', timeoutMs: 5_000 })

    expect(result.exitCode).toBe(3)
    expect(await result.stdout()).toBe('out-1 out-2')
    expect(await result.stderr()).toBe('err-1')
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /containers/abc/exec',
      'POST /exec/exec-1/start',
      'GET /exec/exec-1/json',
    ])
    expect(JSON.parse(requests[0]?.text ?? '')).toEqual({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: ['sh', '-c', 'echo hi; exit 3'],
    })
    expect(JSON.parse(requests[1]?.text ?? '')).toEqual({ Detach: false, Tty: false })
  })

  it('polls until the exec reports an exit code', async () => {
    let inspects = 0
    const { engine } = await serveDaemon((request) => {
      if (request.path === '/containers/abc/exec') return Response.json({ Id: 'exec-1' }, { status: 201 })
      if (request.path === '/exec/exec-1/start') return new Response(frame({ stream: 1, text: 'ok' }))
      inspects += 1
      return inspects < 3
        ? Response.json({ Running: true, ExitCode: null })
        : Response.json({ Running: false, ExitCode: 0 })
    })

    const result = await engine.execSh({ id: 'abc', script: 'true', timeoutMs: 5_000 })

    expect(result.exitCode).toBe(0)
    expect(inspects).toBe(3)
  })

  it('rejects naming the timeout when the stream never ends', async () => {
    const { engine } = await serveDaemon((request) => {
      if (request.path === '/containers/abc/exec') return Response.json({ Id: 'exec-1' }, { status: 201 })
      return new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => controller.enqueue(frame({ stream: 1, text: 'partial' })),
        }),
      )
    })

    const failure = await engine
      .execSh({ id: 'abc', script: 'sleep 999', timeoutMs: 150 })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('timed out after 150ms')
  })
})
