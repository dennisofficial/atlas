import { describe, expect, it } from 'bun:test'
import {
  ECallFailure,
  ECallStatus,
  ELiveOpFailure,
  type CallOp,
  type CallResult,
} from '@dltech/atlas-protocol'

import { PodNotReadyError } from './pod-errors'
import { asUser, listing, opsOf, setupFiles } from './files.service.fixture'

const failureOf = (code: ECallFailure): CallResult => ({
  status: ECallStatus.Failed,
  op: 'readDirectory',
  error: { code, message: `${code} from the pod` },
})

describe('FilesService', () => {
  it('maps readDirectory and joins the changed dot', async () => {
    const seen: CallOp[] = []
    const { files, sessions } = setupFiles(opsOf([listing(['b.ts', 'src'])], seen))
    const sessionId = await asUser(sessions)
    const output = await files.tree({ userId: 'user-a', sessionId, directory: '' })
    expect(seen[0]).toEqual({ op: 'readDirectory', path: '.' })
    expect(output.entries.map((entry) => entry.name)).toEqual(['b.ts', 'src'])
    expect(output.entries.every((entry) => entry.changed === false)).toBe(true)
  })

  it('waits for a holder before it calls the pod', async () => {
    const waits: (boolean | undefined)[] = []
    const { files, sessions } = setupFiles({
      invoke: async (args) => {
        waits.push(args.waitForHolder)
        return { state: 'ok', result: listing(['a.ts']) }
      },
      follow: async () => null,
      events: () => null,
      hold: () => true,
      servesLocally: async () => true,
    })
    const sessionId = await asUser(sessions)
    await files.tree({ userId: 'user-a', sessionId, directory: '' })
    expect(waits).toEqual([true])
  })

  it('throws the not-ready failure when the pod is asleep', async () => {
    const { files, sessions } = setupFiles({
      invoke: async () => ({ state: 'unavailable', reason: ELiveOpFailure.Asleep }),
      follow: async () => null,
      events: () => null,
      hold: () => true,
      servesLocally: async () => true,
    })
    const sessionId = await asUser(sessions)
    const failure = files.tree({ userId: 'user-a', sessionId, directory: '' })
    await expect(failure).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'pod is asleep',
    })
    await expect(failure).rejects.toBeInstanceOf(PodNotReadyError)
  })

  it('reports an op the control plane refuses to run as an internal fault', async () => {
    const { files, sessions } = setupFiles({
      invoke: async () => ({ state: 'unavailable', reason: ELiveOpFailure.Absent }),
      follow: async () => null,
      events: () => null,
      hold: () => true,
      servesLocally: async () => true,
    })
    const sessionId = await asUser(sessions)
    await expect(files.tree({ userId: 'user-a', sessionId, directory: '' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    })
  })

  it('treats a worktree that is not on disk yet as not ready', async () => {
    const { files, sessions } = setupFiles(opsOf([failureOf(ECallFailure.NotFound)]))
    const sessionId = await asUser(sessions)
    await expect(files.tree({ userId: 'user-a', sessionId, directory: '' })).rejects.toBeInstanceOf(
      PodNotReadyError,
    )
  })

  it('attributes any other pod failure with its bounded failure code', async () => {
    const { files, sessions } = setupFiles(opsOf([failureOf(ECallFailure.PermissionDenied)]))
    const sessionId = await asUser(sessions)
    await expect(files.tree({ userId: 'user-a', sessionId, directory: '' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'permission-denied from the pod',
      cause: { response: { podFailure: ECallFailure.PermissionDenied } },
    })
  })

  it('refuses a directory and an oversized file without reading them', async () => {
    const { files, sessions } = setupFiles(
      opsOf([
        {
          status: ECallStatus.Ok,
          op: 'stat',
          value: { size: 0, mode: 0, mtimeMs: 0, isFile: false, isDirectory: true },
        },
        {
          status: ECallStatus.Ok,
          op: 'stat',
          value: { size: 9_000_000, mode: 0, mtimeMs: 0, isFile: true, isDirectory: false },
        },
      ]),
    )
    const sessionId = await asUser(sessions)
    expect(await files.read({ userId: 'user-a', sessionId, path: 'src' })).toEqual({
      file: { type: 'refused', path: 'src', reason: 'not a file' },
    })
    expect(await files.read({ userId: 'user-a', sessionId, path: 'big.log' })).toEqual({
      file: { type: 'refused', path: 'big.log', reason: 'this file is too large to preview' },
    })
  })

  it('returns text for a regular file', async () => {
    const { files, sessions } = setupFiles(
      opsOf([
        {
          status: ECallStatus.Ok,
          op: 'stat',
          value: { size: 10, mode: 0, mtimeMs: 0, isFile: true, isDirectory: false },
        },
        { status: ECallStatus.Ok, op: 'readFile', value: 'export {}' },
      ]),
    )
    const sessionId = await asUser(sessions)
    expect(await files.read({ userId: 'user-a', sessionId, path: 'a.ts' })).toEqual({
      file: { type: 'text', path: 'a.ts', content: 'export {}', truncated: false, bytes: 10 },
    })
  })

  it('escapes the query into a literal glob and caps the results', async () => {
    const seen: CallOp[] = []
    const { files, sessions } = setupFiles(
      opsOf([{ status: ECallStatus.Ok, op: 'glob', value: ['src/a*b.ts'] }], seen),
    )
    const sessionId = await asUser(sessions)
    const output = await files.search({ userId: 'user-a', sessionId, query: 'a*b' })
    expect(seen[0]).toEqual({ op: 'glob', pattern: '**/*a\\*b*', cwd: '.', dot: false })
    expect(output).toEqual({ paths: [{ path: 'src/a*b.ts', positions: [4] }], truncated: false })
  })
})
