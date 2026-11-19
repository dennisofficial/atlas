import { afterEach, describe, expect, it } from 'bun:test'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { daemonToken } from '@dltech/atlas-protocol/engine'

import { daemonBundleAnswerOf } from '../daemon-bundle'

const SECRET = 'daemon-secret'
const SANDBOX = 'atlas-pod-1'
const TOKEN = daemonToken({ secret: SECRET, sandboxName: SANDBOX })

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

const bundleAt = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-daemon-bundle-route-'))
  const path = join(dir, 'daemon.js')
  writeFileSync(path, content)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return path
}

const answerOf = (args: { path: string; authorization?: string; sandboxName?: string }) =>
  daemonBundleAnswerOf({
    secret: SECRET,
    path: args.path,
    authorization: args.authorization,
    sandboxName: args.sandboxName,
  })

describe('daemonBundleAnswerOf', () => {
  it('serves the bundle to the sandbox whose daemon token signs the request', async () => {
    const path = bundleAt('console.log("daemon")\n')
    const answer = await answerOf({
      path,
      authorization: `Bearer ${TOKEN}`,
      sandboxName: SANDBOX,
    })

    expect(answer.kind).toBe('bundle')
    if (answer.kind !== 'bundle') return
    expect(new TextDecoder().decode(answer.content)).toBe('console.log("daemon")\n')
  })

  it('refuses a missing token, a wrong token or a token for another sandbox', async () => {
    const path = bundleAt('x')
    const other = daemonToken({ secret: SECRET, sandboxName: 'atlas-other' })

    expect(await answerOf({ path, sandboxName: SANDBOX })).toEqual({ kind: 'forbidden' })
    expect(await answerOf({ path, authorization: 'Bearer nope', sandboxName: SANDBOX })).toEqual({
      kind: 'forbidden',
    })
    expect(
      await answerOf({ path, authorization: `Bearer ${other}`, sandboxName: SANDBOX }),
    ).toEqual({
      kind: 'forbidden',
    })
    expect(await answerOf({ path, authorization: `Bearer ${TOKEN}` })).toEqual({
      kind: 'forbidden',
    })
  })

  it('reports a bundle the host no longer has', async () => {
    const answer = await answerOf({
      path: join(tmpdir(), 'atlas-daemon-bundle-absent', 'daemon.js'),
      authorization: `Bearer ${TOKEN}`,
      sandboxName: SANDBOX,
    })

    expect(answer).toEqual({ kind: 'missing' })
  })
})
