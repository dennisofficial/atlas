import { describe, expect, it } from 'bun:test'

import type { PrepareResult } from '@dltech/atlas-host'

import { ensureWorkspace } from '../workspace-setup'
import { RecordingProcessPort, StubFileSystemPort } from './workspace-fakes'

const SANDBOX = 'sandbox-acks'

class HeldAcks {
  readonly scopes: string[] = []
  private readonly releases: (() => void)[] = []

  ackScope = (args: { scopeKey: string }): Promise<void> => {
    this.scopes.push(args.scopeKey)
    return new Promise<void>((resolve) => this.releases.push(resolve))
  }

  async releaseAll(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
      for (const release of this.releases.splice(0)) release()
      await Bun.sleep(0)
    }
  }
}

const prepare = (args: {
  acks: HeldAcks
  setupScript: string
  signal?: AbortSignal | undefined
}): { settled: () => PrepareResult | undefined; done: Promise<PrepareResult> } => {
  let result: PrepareResult | undefined
  const done = ensureWorkspace({
    calls: { ackScope: args.acks.ackScope },
    processes: new RecordingProcessPort(),
    files: new StubFileSystemPort(),
    workspace: {
      remoteUrl: null,
      baseBranch: null,
      additionalRepos: [],
      setupScript: args.setupScript,
    },
    githubToken: null,
    launchDirectory: '/workspace/repo',
    sandboxName: SANDBOX,
    ...(args.signal === undefined ? {} : { signal: args.signal }),
  }).then((prepared) => {
    result = prepared
    return prepared
  })
  return { settled: () => result, done }
}

describe('workspace prepare scope acks', () => {
  it('reports a prepared workspace before the daemon answers its scope acks', async () => {
    const acks = new HeldAcks()
    const { done } = prepare({ acks, setupScript: '' })

    expect(await done).toEqual({ ok: true })
    expect(acks.scopes).toEqual([`setup:${SANDBOX}:check`])

    await acks.releaseAll()
    expect(acks.scopes).toEqual([
      `setup:${SANDBOX}:check`,
      `setup:${SANDBOX}:clone`,
      `setup:${SANDBOX}:files`,
      `setup:${SANDBOX}:setup`,
    ])
  })

  it('leaves the background setup scope to the setup script', async () => {
    const acks = new HeldAcks()
    const { done } = prepare({ acks, setupScript: 'bun install' })

    expect(await done).toEqual({ ok: true })
    await acks.releaseAll()
    const setupScope = `setup:${SANDBOX}:setup`
    expect(acks.scopes.filter((scope) => scope !== setupScope)).toEqual([
      `setup:${SANDBOX}:check`,
      `setup:${SANDBOX}:clone`,
      `setup:${SANDBOX}:files`,
    ])
    expect(acks.scopes.filter((scope) => scope === setupScope)).toHaveLength(1)
  })

  it('holds a failed prepare until its scopes are acked so a retry starts clean', async () => {
    const acks = new HeldAcks()
    const aborted = new AbortController()
    aborted.abort(new Error('deadline'))
    const { settled, done } = prepare({ acks, setupScript: '', signal: aborted.signal })

    await Bun.sleep(5)
    expect(settled()).toBeUndefined()

    await acks.releaseAll()
    expect((await done).ok).toBe(false)
    expect(acks.scopes).toHaveLength(4)
  })
})
