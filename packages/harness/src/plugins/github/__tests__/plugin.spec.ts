import { EHookPhase } from '@dltech/atlas-core'
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CloudSessionStore } from '../../../cloud/cloud-session'
import { createIsolatedContainer, portToken } from '../../../container/injection'
import {
  ClientVersionToken,
  CloudSessionStoreToken,
  ServeSessionToken,
  WorkspaceRoot,
} from '../../../container/tokens'

import { NativePlugin } from '../../plugin'
import { ApiPullRequestPort } from '../api-pull-requests'
import { GhPullRequestPort } from '../gh-pull-requests'
import GithubPlugin, { registerPlugin } from '../index'
import { PullRequestPort } from '../pure'
import { GithubUiBridgePort } from '../ui-bridge'

const made: string[] = []

const scratch = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), 'atlas-gh-plugin-'))
  made.push(path)
  return path
}

afterAll(async () => {
  await Promise.all(made.map((path) => rm(path, { recursive: true, force: true })))
})

const SESSION = { url: 'https://api.byatlas.io', token: 'atlas_token', email: null }

const sessionsIn = async (args: { signedIn: boolean }): Promise<CloudSessionStore> => {
  const root = await scratch()
  const store = new CloudSessionStore({
    file: join(root, 'cloud.json'),
    keyFile: join(root, 'vault.key'),
  })
  if (args.signedIn) store.write(SESSION)
  return store
}

const resolved = async (args?: {
  signedIn?: boolean
  serve?: boolean
}): Promise<{ plugin: GithubPlugin; contribution: Awaited<ReturnType<GithubPlugin['contribute']>> }> => {
  const container = createIsolatedContainer()
  container.register(WorkspaceRoot, { useValue: '/work/atlas' })
  container.register(ClientVersionToken, { useValue: 'test' })
  container.register(CloudSessionStoreToken, {
    useValue: await sessionsIn({ signedIn: args?.signedIn === true }),
  })
  if (args?.serve === true) container.register(ServeSessionToken, { useValue: SESSION })
  registerPlugin({ container })

  const plugin = container.resolve(portToken(NativePlugin))
  if (!(plugin instanceof GithubPlugin)) throw new Error('the container answered something else')

  return { plugin, contribution: await plugin.contribute() }
}

const portOf = (contribution: Awaited<ReturnType<GithubPlugin['contribute']>>): PullRequestPort => {
  const binding = (contribution.ports ?? []).find((entry) => entry.token === PullRequestPort)
  if (binding === undefined) throw new Error('no PullRequestPort was contributed')
  return binding.use as PullRequestPort
}

describe('the github plugin as the loader sees it', () => {
  it('is a native the container can build from its id alone', async () => {
    expect((await resolved()).plugin.id).toBe('github')
  })

  /**
   * The loader builds every native before shadowing decides which survive, so anything the
   * constructor started would outlive a plugin that never loads. `setInterval` is what the poller
   * arms, and it is the thing that must not be armed yet.
   */
  it('arms nothing until it is asked to contribute', async () => {
    const armed: unknown[] = []
    const real = globalThis.setInterval
    Object.defineProperty(globalThis, 'setInterval', {
      configurable: true,
      writable: true,
      value: (...args: unknown[]) => {
        armed.push(args)
        return real(() => undefined, 1_000_000)
      },
    })

    try {
      await resolved()
      expect(armed).toEqual([])
    } finally {
      Object.defineProperty(globalThis, 'setInterval', {
        configurable: true,
        writable: true,
        value: real,
      })
    }
  })

  it('contributes the hooks the feature listens on, its ports and its projections, but no UI surface', async () => {
    const { contribution } = await resolved()

    expect((contribution.hooks ?? []).map((hook) => `${hook.phase}:${hook.name}`)).toEqual([
      `${EHookPhase.BeforeTurn}:follow-session`,
      `${EHookPhase.BeforeTurn}:track-checkout`,
      `${EHookPhase.AfterTurn}:turn-ended`,
      `${EHookPhase.AfterTurn}:follow-checkout`,
      `${EHookPhase.AfterTurn}:record-pull-request`,
      `${EHookPhase.OnThreadOpen}:thread-opened`,
      `${EHookPhase.OnThreadOpen}:forget-thread-links`,
      `${EHookPhase.AfterTool}:follow-worktree`,
      `${EHookPhase.AfterTool}:refresh-pull-request`,
      `${EHookPhase.AfterShell}:refresh-pull-request-after-shell`,
    ])
    expect(contribution.surfaces ?? []).toEqual([])
    expect((contribution.projections ?? []).map((projection) => projection.id)).toEqual([
      'pull-requests',
      'cloud-checkout',
    ])
    expect((contribution.ports ?? []).map((binding) => binding.token)).toEqual([
      PullRequestPort,
      GithubUiBridgePort,
    ])
    expect(contribution.tools ?? []).toEqual([])

    await contribution.dispose?.()
  })

  it('hands back a dispose that stops the service it started', async () => {
    const { contribution } = await resolved()

    expect(contribution.dispose).toBeDefined()
    await contribution.dispose?.()
  })
})

describe('the pull request port the plugin selects', () => {
  it('keeps the gh poller for a signed-out session', async () => {
    const { contribution } = await resolved({ signedIn: false })

    expect(portOf(contribution)).toBeInstanceOf(GhPullRequestPort)

    await contribution.dispose?.()
  })

  it('answers through the API for a signed-in session', async () => {
    const { contribution } = await resolved({ signedIn: true })

    expect(portOf(contribution)).toBeInstanceOf(ApiPullRequestPort)

    await contribution.dispose?.()
  })

  it('answers through the API inside a sandbox, signed out or not', async () => {
    const { contribution } = await resolved({ serve: true })

    expect(portOf(contribution)).toBeInstanceOf(ApiPullRequestPort)

    await contribution.dispose?.()
  })
})
