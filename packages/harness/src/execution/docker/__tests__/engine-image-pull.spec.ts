import { afterEach, describe, expect, it } from 'vitest'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DockerEngine, EngineRequestFailed } from '../engine'
import { ImagePullError } from '../image-pull'

const IMAGE = 'registry.example:5000/team/node:22-trixie-slim'
const CREATE = {
  name: 'atlas-pull-test',
  body: { Image: IMAGE, Cmd: ['sleep', 'infinity'], User: '501:20' },
}

type RecordedRequest = {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
}
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function serveDaemon(responses: readonly Response[]) {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-engine-'))
  const socketPath = join(directory, 'docker.sock')
  const requests: RecordedRequest[] = []
  const server = Bun.serve({
    unix: socketPath,
    async fetch(request) {
      const url = new URL(request.url)
      const text = await request.text()
      const body: unknown = text === '' ? undefined : JSON.parse(text)
      requests.push({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body,
      })
      return responses[requests.length - 1] ?? new Response('unexpected request', { status: 500 })
    },
  })
  cleanups.push(async () => {
    await server.stop(true)
    await rm(directory, { recursive: true, force: true })
  })
  return { engine: new DockerEngine({ socketPath }), requests }
}

const missingImage = (): Response =>
  Response.json({ message: `No such image: ${IMAGE}` }, { status: 404 })

const created = (): Response =>
  Response.json({ Id: 'container-id', Warnings: ['daemon warning', 42] }, { status: 201 })

describe('DockerEngine missing image recovery', () => {
  it('does not pull an image already cached by the daemon', async () => {
    const { engine, requests } = await serveDaemon([created()])

    expect(await engine.createContainer(CREATE)).toEqual({
      id: 'container-id',
      warnings: ['daemon warning'],
    })
    expect(requests).toHaveLength(1)
  })

  it.each([
    { status: 404, message: 'No such container: missing' },
    { status: 404, message: `No such image: ${IMAGE}-other` },
    { status: 404, message: 'No such image: unrelated:latest' },
    { status: 409, message: 'Conflict. The container name is already in use' },
    { status: 500, message: `No such image: ${IMAGE}` },
  ])('preserves unrelated create failures: %j', async (failure) => {
    const { engine, requests } = await serveDaemon([
      Response.json({ message: failure.message }, { status: failure.status }),
    ])

    const error: unknown = await engine.createContainer(CREATE).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(EngineRequestFailed)
    expect(error).toMatchObject(failure)
    expect(requests).toHaveLength(1)
  })

  it('names the image in an ImagePullError when the pull fails over HTTP, without retrying creation', async () => {
    const { engine, requests } = await serveDaemon([
      missingImage(),
      Response.json({ message: 'registry unavailable' }, { status: 503 }),
    ])

    const error: unknown = await engine.createContainer(CREATE).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(ImagePullError)
    expect(error).toMatchObject({ name: 'ImagePullError', image: IMAGE })
    expect((error as ImagePullError).message).toBe(
      `could not pull ${IMAGE} — check Docker is running and can reach ghcr.io (the image is public; no registry login is needed): registry unavailable`,
    )
    expect((error as ImagePullError).cause).toBeInstanceOf(EngineRequestFailed)
    expect(requests).toHaveLength(2)
  })

  it('names the image in an ImagePullError when the daemon reports a pull error in the stream', async () => {
    const { engine } = await serveDaemon([
      missingImage(),
      new Response('{"error":"denied: requested access to the resource is denied"}\n'),
    ])

    const error: unknown = await engine.createContainer(CREATE).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(ImagePullError)
    expect(error).toMatchObject({ image: IMAGE })
    expect((error as ImagePullError).message).toContain(
      'requested access to the resource is denied',
    )
  })

  it('sends no authorization header with the pull', async () => {
    const headers: Headers[] = []
    const directory = await mkdtemp(join(tmpdir(), 'atlas-engine-'))
    const socketPath = join(directory, 'docker.sock')
    let calls = 0
    const server = Bun.serve({
      unix: socketPath,
      fetch(request) {
        calls += 1
        if (new URL(request.url).pathname === '/images/create') headers.push(request.headers)
        if (calls === 1) return missingImage()
        if (calls === 2) return new Response('{"status":"done"}\n')
        return created()
      },
    })
    cleanups.push(async () => {
      await server.stop(true)
      await rm(directory, { recursive: true, force: true })
    })

    await new DockerEngine({ socketPath }).createContainer(CREATE)

    expect(headers).toHaveLength(1)
    expect(headers[0]?.get('authorization')).toBeNull()
    expect(headers[0]?.get('x-registry-auth')).toBeNull()
  })

  it('keeps the create error as is when the retried create fails after a successful pull', async () => {
    const { engine } = await serveDaemon([
      missingImage(),
      new Response('{"status":"done"}\n'),
      Response.json({ message: 'Conflict. The container name is already in use' }, { status: 409 }),
    ])

    const error: unknown = await engine.createContainer(CREATE).catch((error: unknown) => error)
    expect(error).not.toBeInstanceOf(ImagePullError)
    expect(error).toBeInstanceOf(EngineRequestFailed)
  })

  it('does not pull again when the retried create still cannot find the image', async () => {
    const { engine, requests } = await serveDaemon([
      missingImage(),
      new Response('{"status":"Already exists"}\n'),
      missingImage(),
    ])

    const error: unknown = await engine.createContainer(CREATE).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(EngineRequestFailed)
    expect(error).toMatchObject({ status: 404, message: `No such image: ${IMAGE}` })
    expect(requests.map((request) => request.path)).toEqual([
      '/containers/create',
      '/images/create',
      '/containers/create',
    ])
  })

  it.each(['not JSON', 'null'])(
    'rejects malformed pull progress without retrying: %s',
    async (output) => {
      const { engine, requests } = await serveDaemon([missingImage(), new Response(output)])

      await expect(engine.createContainer(CREATE)).rejects.toThrow()
      expect(requests).toHaveLength(2)
    },
  )

  it('does not pull when a different API reports a missing image', async () => {
    const { engine, requests } = await serveDaemon([missingImage()])

    await expect(engine.inspectContainer({ id: 'missing' })).rejects.toThrow(
      `No such image: ${IMAGE}`,
    )
    expect(requests).toHaveLength(1)
  })

  it('reads an error split across stream chunks without a final newline', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of ['{"status":"Pulling"}\r\n\n{"err', 'or":"download interrupted"}']) {
          controller.enqueue(new TextEncoder().encode(chunk))
        }
        controller.close()
      },
    })
    const { engine, requests } = await serveDaemon([missingImage(), new Response(stream)])

    await expect(engine.createContainer(CREATE)).rejects.toThrow('download interrupted')
    expect(requests).toHaveLength(2)
  })

  it.each([
    { error: 'registry access denied' },
    { errorDetail: { message: 'registry access denied' } },
  ])('rejects a successful HTTP pull containing a daemon error: %j', async (failure) => {
    const { engine, requests } = await serveDaemon([
      missingImage(),
      new Response(`{"status":"Pulling"}\n${JSON.stringify(failure)}\n`),
      created(),
    ])

    await expect(engine.createContainer(CREATE)).rejects.toThrow('registry access denied')
    expect(requests.map((request) => request.path)).toEqual([
      '/containers/create',
      '/images/create',
    ])
  })

  it('pulls the requested image and retries the identical create request once', async () => {
    const { engine, requests } = await serveDaemon([
      missingImage(),
      new Response('{"status":"Pulling"}\n{"status":"Download complete"}\n'),
      created(),
    ])

    expect(await engine.createContainer(CREATE)).toEqual({
      id: 'container-id',
      warnings: ['daemon warning'],
    })
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/containers/create',
        query: { name: CREATE.name },
        body: CREATE.body,
      },
      { method: 'POST', path: '/images/create', query: { fromImage: IMAGE }, body: undefined },
      {
        method: 'POST',
        path: '/containers/create',
        query: { name: CREATE.name },
        body: CREATE.body,
      },
    ])
  })
})
