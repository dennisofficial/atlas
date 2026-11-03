import { describe, expect, it } from 'bun:test'

import type { CallOp } from '../../ops'
import type { DaemonSession } from '../client'
import { helloAt, tokenFor } from './calls'
import type { DaemonConformanceTarget, DaemonSpawnedHandle } from './suite'

const EPOCH = 11

let counter = 0
const workdir = (): string => {
  counter += 1
  return `/tmp/atlas-conformance-${process.pid}-${counter}`
}

const runOp = async (
  session: DaemonSession,
  args: { key: string; op: CallOp },
): Promise<unknown> => {
  session.send({ kind: 'run', key: args.key, epoch: EPOCH, op: args.op })
  const result = await session.until((frame) => frame.kind === 'result' && frame.key === args.key)
  if (result.kind !== 'result') throw new Error('no result')
  return result.result
}

export const describeFilesConformance = (target: DaemonConformanceTarget): void => {
  describe(`files conformance (${target.name})`, () => {
    it('round-trips write, stat, read, list, glob and remove', async () => {
      const handle: DaemonSpawnedHandle = await target.setup()
      try {
        const session = await target.connect(handle)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(handle) })
        const dir = workdir()

        await runOp(session, { key: 'f-mkdir', op: { op: 'mkdir', path: dir } })
        await runOp(session, {
          key: 'f-write',
          op: { op: 'writeFile', path: `${dir}/hello.txt`, content: 'hello daemon' },
        })

        const stat = (await runOp(session, {
          key: 'f-stat',
          op: { op: 'stat', path: `${dir}/hello.txt` },
        })) as { isFile: boolean; size: number }
        expect(stat.isFile).toBe(true)
        expect(stat.size).toBe(12)

        const read = await runOp(session, {
          key: 'f-read',
          op: { op: 'readFile', path: `${dir}/hello.txt` },
        })
        expect(read).toBe('hello daemon')

        const edit = (await runOp(session, {
          key: 'f-edit',
          op: { op: 'readTextForEdit', path: `${dir}/hello.txt` },
        })) as { text: string; strict: string | null }
        expect(edit).toEqual({ text: 'hello daemon', strict: 'hello daemon' })

        const listing = (await runOp(session, {
          key: 'f-list',
          op: { op: 'readDirectory', path: dir },
        })) as { name: string; isFile: boolean }[]
        expect(listing.map((entry) => entry.name)).toEqual(['hello.txt'])

        const globbed = (await runOp(session, {
          key: 'f-glob',
          op: { op: 'glob', pattern: '**/*.txt', cwd: dir },
        })) as string[]
        expect(globbed).toEqual(['hello.txt'])

        await runOp(session, {
          key: 'f-rename',
          op: { op: 'rename', from: `${dir}/hello.txt`, to: `${dir}/renamed.txt` },
        })
        const renamed = await runOp(session, {
          key: 'f-read-2',
          op: { op: 'readFile', path: `${dir}/renamed.txt` },
        })
        expect(renamed).toBe('hello daemon')

        await runOp(session, { key: 'f-rm', op: { op: 'remove', path: dir } })
        const gone = (await runOp(session, {
          key: 'f-list-2',
          op: { op: 'readDirectory', path: '/tmp' },
        })) as { name: string }[]
        expect(gone.some((entry) => entry.name === dir.slice(5))).toBe(false)
      } finally {
        await target.teardown(handle)
      }
    })

    it('round-trips binary bytes through readBytes', async () => {
      const handle = await target.setup()
      try {
        const session = await target.connect(handle)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(handle) })
        const dir = workdir()
        await runOp(session, { key: 'b-mkdir', op: { op: 'mkdir', path: dir } })
        const binary = Uint8Array.from([0, 1, 2, 250, 251, 255, 10, 13])
        const base64 = Buffer.from(binary).toString('base64')
        await runOp(session, {
          key: 'b-write',
          op: {
            op: 'exec',
            argv: ['/bin/sh', '-c', `printf '%s' '${base64}' | base64 -d > ${dir}/blob.bin`],
          },
        })
        const read = (await runOp(session, {
          key: 'b-read',
          op: { op: 'readBytes', path: `${dir}/blob.bin` },
        })) as string
        expect(Buffer.from(read, 'base64')).toEqual(Buffer.from(binary))
        await runOp(session, { key: 'b-rm', op: { op: 'remove', path: dir } })
      } finally {
        await target.teardown(handle)
      }
    })

    it('greps with line numbers, glob filter and case folding', async () => {
      const handle = await target.setup()
      try {
        const session = await target.connect(handle)
        await helloAt(session, { epoch: EPOCH, sessionId: 's', token: tokenFor(handle) })
        const dir = workdir()
        await runOp(session, { key: 'g-mkdir', op: { op: 'mkdir', path: dir } })
        await runOp(session, {
          key: 'g-write-1',
          op: { op: 'writeFile', path: `${dir}/one.ts`, content: 'const Needle = 1\nother line\n' },
        })
        await runOp(session, {
          key: 'g-write-2',
          op: { op: 'writeFile', path: `${dir}/two.md`, content: 'a needle in markdown\n' },
        })

        const matches = (await runOp(session, {
          key: 'g-grep',
          op: { op: 'grep', pattern: 'needle', path: dir, caseInsensitive: true },
        })) as { path: string; line: number; text: string }[]
        expect(matches.length).toBeGreaterThanOrEqual(2)
        const ts = matches.find((match) => match.path.endsWith('one.ts'))
        expect(ts?.line).toBe(1)

        const onlyTs = (await runOp(session, {
          key: 'g-grep-glob',
          op: { op: 'grep', pattern: 'needle', path: dir, caseInsensitive: true, glob: '*.ts' },
        })) as { path: string }[]
        expect(onlyTs.every((match) => match.path.endsWith('.ts'))).toBe(true)

        const capped = (await runOp(session, {
          key: 'g-grep-max',
          op: { op: 'grep', pattern: 'needle', path: dir, caseInsensitive: true, maxResults: 1 },
        })) as { path: string }[]
        expect(capped.length).toBe(1)

        await runOp(session, { key: 'g-rm', op: { op: 'remove', path: dir } })
      } finally {
        await target.teardown(handle)
      }
    })
  })
}
