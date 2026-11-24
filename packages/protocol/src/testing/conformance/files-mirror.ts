import { describe, expect, it } from 'bun:test'

import { ECallFailure } from '../../ops'
import type { DaemonSession } from '../client'
import {
  connectAt,
  failureOf,
  okValue,
  runToEnd,
  withDaemon,
  type DaemonConformanceTarget,
} from './support'

const FIXTURE = Uint8Array.from([0, 1, 2, 250, 251, 255, 10, 13, 42])
const HEAD_BYTES = 8192
const LARGE = Uint8Array.from({ length: HEAD_BYTES + 500 }, (_, index) => index % 256)

let counter = 0
const workdir = (): string => {
  counter += 1
  return `/tmp/atlas-conformance-mirror-${process.pid}-${Date.now()}-${counter}`
}

let keys = 0
const run = (args: { session: DaemonSession; op: Parameters<typeof runToEnd>[0]['op'] }) => {
  keys += 1
  return runToEnd({ session: args.session, key: `fm-${keys}`, op: args.op })
}

const sha256Of = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher('sha256').update(bytes).digest('hex')

const withPutServer = async (
  body: (args: { base: string; received: () => Buffer }) => Promise<void>,
): Promise<void> => {
  const chunks: Uint8Array[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      if (new URL(request.url).pathname === '/refuse') {
        return new Response('the bucket refused the object', { status: 500 })
      }
      chunks.push(new Uint8Array(await request.arrayBuffer()))
      return new Response(null, { status: 200 })
    },
  })
  try {
    await body({
      base: `http://127.0.0.1:${server.port}`,
      received: () => Buffer.concat(chunks),
    })
  } finally {
    await server.stop(true)
  }
}

export const describeFilesMirrorConformance = (target: DaemonConformanceTarget): void => {
  describe(`files mirror conformance (${target.name})`, () => {
    it('digests a file and keeps only its head', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const dir = workdir()
          await run({ session, op: { op: 'mkdir', path: dir } })
          const path = `${dir}/blob.bin`
          await run({
            session,
            op: {
              op: 'writeFile',
              path,
              content: Buffer.from(LARGE).toString('base64'),
              encoding: 'base64',
            },
          })
          const digest = okValue({
            result: await run({ session, op: { op: 'digestFile', path } }),
            op: 'digestFile',
          })
          expect(digest).toEqual({
            sha256: sha256Of(LARGE),
            size: LARGE.length,
            head: Buffer.from(LARGE.subarray(0, HEAD_BYTES)).toString('base64'),
          })
          await run({ session, op: { op: 'remove', path: dir } })
        },
      }))

    it('settles a missing path as a not-found result', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const missing = `${workdir()}/nope`
          expect(failureOf(await run({ session, op: { op: 'digestFile', path: missing } }))).toBe(
            ECallFailure.NotFound,
          )
          expect(
            failureOf(
              await run({
                session,
                op: { op: 'putFile', path: missing, url: 'http://127.0.0.1:1/put', size: 0 },
              }),
            ),
          ).toBe(ECallFailure.NotFound)
        },
      }))

    it('puts a file to a presigned url and reports what it sent', () =>
      withPutServer((server) =>
        withDaemon({
          target,
          body: async (handle) => {
            const session = await connectAt({ handle })
            const dir = workdir()
            await run({ session, op: { op: 'mkdir', path: dir } })
            const path = `${dir}/blob.bin`
            await run({
              session,
              op: {
                op: 'writeFile',
                path,
                content: Buffer.from(FIXTURE).toString('base64'),
                encoding: 'base64',
              },
            })
            const put = okValue({
              result: await run({
                session,
                op: { op: 'putFile', path, url: `${server.base}/put`, size: FIXTURE.length },
              }),
              op: 'putFile',
            })
            expect(put).toEqual({ sha256: sha256Of(FIXTURE), size: FIXTURE.length })
            expect(server.received()).toEqual(Buffer.from(FIXTURE))
            await run({ session, op: { op: 'remove', path: dir } })
          },
        }),
      ))

    it('fails the call when the bucket refuses the put', () =>
      withPutServer((server) =>
        withDaemon({
          target,
          body: async (handle) => {
            const session = await connectAt({ handle })
            const dir = workdir()
            await run({ session, op: { op: 'mkdir', path: dir } })
            const path = `${dir}/blob.bin`
            await run({ session, op: { op: 'writeFile', path, content: 'refused' } })
            const put = await run({
              session,
              op: {
                op: 'putFile',
                path,
                url: `${server.base}/refuse`,
                size: 7,
              },
            })
            expect(failureOf(put)).toBe(ECallFailure.Internal)
            await run({ session, op: { op: 'remove', path: dir } })
          },
        }),
      ))
  })
}
