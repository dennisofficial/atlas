import { describe, expect, it } from 'bun:test'

import { ECallFailure } from '../../ops'
import type { DaemonSession } from '../client'
import {
  connectAt,
  failureOf,
  okValue,
  runToEnd,
  shell,
  withDaemon,
  type DaemonConformanceTarget,
} from './support'

let counter = 0
const workdir = (): string => {
  counter += 1
  return `/tmp/atlas-conformance-${process.pid}-${Date.now()}-${counter}`
}

let keys = 0
const run = (args: { session: DaemonSession; op: Parameters<typeof runToEnd>[0]['op'] }) => {
  keys += 1
  return runToEnd({ session: args.session, key: `f-${keys}`, op: args.op })
}

const FIXTURE = Uint8Array.from([0, 1, 2, 250, 251, 255, 10, 13, 42])

const withBlobServer = async (body: (base: string) => Promise<void>): Promise<void> => {
  const server = Bun.serve({
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/ok'
        ? new Response(FIXTURE)
        : new Response('gone', { status: 404 }),
  })
  try {
    await body(`http://127.0.0.1:${server.port}`)
  } finally {
    await server.stop(true)
  }
}

export const describeFilesConformance = (target: DaemonConformanceTarget): void => {
  describe(`files conformance (${target.name})`, () => {
    it('round-trips write, stat, read, list, glob, rename and remove', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const dir = workdir()
          okValue({ result: await run({ session, op: { op: 'mkdir', path: dir } }), op: 'mkdir' })
          const file = `${dir}/hello.txt`
          await run({ session, op: { op: 'writeFile', path: file, content: 'hello daemon' } })

          const stat = okValue({
            result: await run({ session, op: { op: 'stat', path: file } }),
            op: 'stat',
          })
          expect(stat.isFile).toBe(true)
          expect(stat.size).toBe(12)
          const read = await run({ session, op: { op: 'readFile', path: file } })
          expect(okValue({ result: read, op: 'readFile' })).toBe('hello daemon')
          const edit = await run({ session, op: { op: 'readTextForEdit', path: file } })
          expect(okValue({ result: edit, op: 'readTextForEdit' })).toEqual({
            text: 'hello daemon',
            strict: 'hello daemon',
          })
          const listing = await run({ session, op: { op: 'readDirectory', path: dir } })
          expect(
            okValue({ result: listing, op: 'readDirectory' }).map((entry) => entry.name),
          ).toEqual(['hello.txt'])
          const globbed = await run({ session, op: { op: 'glob', pattern: '**/*.txt', cwd: dir } })
          expect(okValue({ result: globbed, op: 'glob' })).toEqual(['hello.txt'])

          const renamed = `${dir}/renamed.txt`
          await run({ session, op: { op: 'rename', from: file, to: renamed } })
          const after = await run({ session, op: { op: 'readFile', path: renamed } })
          expect(okValue({ result: after, op: 'readFile' })).toBe('hello daemon')
          await run({ session, op: { op: 'remove', path: dir } })
          expect(failureOf(await run({ session, op: { op: 'stat', path: dir } }))).toBe(
            ECallFailure.NotFound,
          )
        },
      }))

    it('settles a missing path as a not-found result instead of hanging', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const missing = `${workdir()}/nope`
          for (const op of [
            { op: 'readFile', path: missing },
            { op: 'readBytes', path: missing },
            { op: 'readDirectory', path: missing },
            { op: 'rename', from: missing, to: `${missing}-2` },
          ] as const) {
            expect(failureOf(await run({ session, op }))).toBe(ECallFailure.NotFound)
          }
        },
      }))

    it('reads a symlink leaf, and null for a plain path', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const dir = workdir()
          await run({ session, op: { op: 'mkdir', path: dir } })
          const file = `${dir}/real.txt`
          await run({ session, op: { op: 'writeFile', path: file, content: 'link me' } })
          expect(
            okValue({
              result: await run({ session, op: { op: 'readLink', path: file } }),
              op: 'readLink',
            }),
          ).toBeNull()
          if (handle.realProcesses) {
            await run({ session, op: shell(`ln -s real.txt ${dir}/link.txt`) })
            expect(
              okValue({
                result: await run({ session, op: { op: 'readLink', path: `${dir}/link.txt` } }),
                op: 'readLink',
              }),
            ).toBe('real.txt')
          }
          expect(
            failureOf(await run({ session, op: { op: 'readLink', path: `${dir}/nope` } })),
          ).toBe(ECallFailure.NotFound)
          await run({ session, op: { op: 'remove', path: dir } })
        },
      }))

    it('round-trips binary bytes through readBytes', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const dir = workdir()
          await run({ session, op: { op: 'mkdir', path: dir } })
          const binary = Uint8Array.from([0, 1, 2, 250, 251, 255, 10, 13])
          const base64 = Buffer.from(binary).toString('base64')
          await run({ session, op: shell(`printf '%s' '${base64}' | base64 -d > ${dir}/blob.bin`) })
          const read = await run({ session, op: { op: 'readBytes', path: `${dir}/blob.bin` } })
          expect(Buffer.from(okValue({ result: read, op: 'readBytes' }), 'base64')).toEqual(
            Buffer.from(binary),
          )
          await run({ session, op: { op: 'remove', path: dir } })
        },
      }))

    it('writes bytes handed over as base64 byte for byte', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const dir = workdir()
          await run({ session, op: { op: 'mkdir', path: dir } })
          await run({
            session,
            op: {
              op: 'writeFile',
              path: `${dir}/blob.bin`,
              content: Buffer.from(FIXTURE).toString('base64'),
              encoding: 'base64',
            },
          })
          const read = await run({ session, op: { op: 'readBytes', path: `${dir}/blob.bin` } })
          expect(Buffer.from(okValue({ result: read, op: 'readBytes' }), 'base64')).toEqual(
            Buffer.from(FIXTURE),
          )
          await run({ session, op: { op: 'remove', path: dir } })
        },
      }))

    it('greps every match in a file, with a glob filter, case folding and a cap', () =>
      withDaemon({
        target,
        body: async (handle) => {
          const session = await connectAt({ handle })
          const dir = workdir()
          await run({ session, op: { op: 'mkdir', path: dir } })
          await run({
            session,
            op: {
              op: 'writeFile',
              path: `${dir}/one.ts`,
              content: 'const Needle = 1\nother\nneedle again\n',
            },
          })
          await run({
            session,
            op: { op: 'writeFile', path: `${dir}/two.md`, content: 'a needle here\n' },
          })

          const all = await run({
            session,
            op: { op: 'grep', pattern: 'needle', path: dir, caseInsensitive: true },
          })
          const matches = okValue({ result: all, op: 'grep' })
          expect(matches.length).toBe(3)
          const lines = matches
            .filter((match) => match.path.endsWith('one.ts'))
            .map((match) => match.line)
            .sort()
          expect(lines).toEqual([1, 3])

          const onlyTs = await run({
            session,
            op: { op: 'grep', pattern: 'needle', path: dir, caseInsensitive: true, glob: '*.ts' },
          })
          expect(
            okValue({ result: onlyTs, op: 'grep' }).every((match) => match.path.endsWith('.ts')),
          ).toBe(true)

          const capped = await run({
            session,
            op: { op: 'grep', pattern: 'needle', path: dir, caseInsensitive: true, maxResults: 2 },
          })
          expect(okValue({ result: capped, op: 'grep' }).length).toBe(2)

          const single = await run({
            session,
            op: { op: 'grep', pattern: 'again', path: `${dir}/one.ts` },
          })
          expect(okValue({ result: single, op: 'grep' }).map((match) => match.line)).toEqual([3])
          await run({ session, op: { op: 'remove', path: dir } })
        },
      }))

    it('fetches a url into a new nested directory', () =>
      withBlobServer((base) =>
        withDaemon({
          target,
          body: async (handle) => {
            const session = await connectAt({ handle })
            const dir = workdir()
            const path = `${dir}/nested/deeper/blob.bin`
            const fetched = await run({
              session,
              op: { op: 'fetchToFile', url: `${base}/ok`, path, size: FIXTURE.length },
            })
            okValue({ result: fetched, op: 'fetchToFile' })
            const read = await run({ session, op: { op: 'readBytes', path } })
            expect(Buffer.from(okValue({ result: read, op: 'readBytes' }), 'base64')).toEqual(
              Buffer.from(FIXTURE),
            )
            await run({ session, op: { op: 'remove', path: dir } })
          },
        }),
      ))

    it('rejects a size mismatch and leaves neither the file nor its part', () =>
      withBlobServer((base) =>
        withDaemon({
          target,
          body: async (handle) => {
            const session = await connectAt({ handle })
            const dir = workdir()
            const path = `${dir}/blob.bin`
            const fetched = await run({
              session,
              op: { op: 'fetchToFile', url: `${base}/ok`, path, size: FIXTURE.length + 1 },
            })
            expect(failureOf(fetched)).toBe(ECallFailure.InvalidInput)
            for (const left of [path, `${path}.part`]) {
              expect(failureOf(await run({ session, op: { op: 'stat', path: left } }))).toBe(
                ECallFailure.NotFound,
              )
            }
            await run({ session, op: { op: 'remove', path: dir } })
          },
        }),
      ))

    it('fails on a 404 and leaves nothing behind', () =>
      withBlobServer((base) =>
        withDaemon({
          target,
          body: async (handle) => {
            const session = await connectAt({ handle })
            const dir = workdir()
            const path = `${dir}/blob.bin`
            const fetched = await run({
              session,
              op: { op: 'fetchToFile', url: `${base}/gone`, path, size: 4 },
            })
            expect(fetched.status).not.toBe('ok')
            for (const left of [path, `${path}.part`]) {
              expect(failureOf(await run({ session, op: { op: 'stat', path: left } }))).toBe(
                ECallFailure.NotFound,
              )
            }
            await run({ session, op: { op: 'remove', path: dir } })
          },
        }),
      ))
  })
}
