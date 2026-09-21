import { EHookPhase } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { createIsolatedContainer, portToken } from '../../../container/injection'
import { WorkspaceRoot } from '../../../container/tokens'

import { NativePlugin } from '../../plugin'
import GithubPlugin, { registerPlugin } from '../index'
import { PullRequestPort } from '../pure'
import { GithubUiBridgePort } from '../ui-bridge'

const resolved = (): GithubPlugin => {
  const container = createIsolatedContainer()
  container.register(WorkspaceRoot, { useValue: '/work/atlas' })
  registerPlugin({ container })

  const plugin = container.resolve(portToken(NativePlugin))
  if (!(plugin instanceof GithubPlugin)) throw new Error('the container answered something else')

  return plugin
}

describe('the github plugin as the loader sees it', () => {
  it('is a native the container can build from its id alone', () => {
    expect(resolved().id).toBe('github')
  })

  /**
   * The loader builds every native before shadowing decides which survive, so anything the
   * constructor started would outlive a plugin that never loads. `setInterval` is what the poller
   * arms, and it is the thing that must not be armed yet.
   */
  it('arms nothing until it is asked to contribute', () => {
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
      resolved()
      expect(armed).toEqual([])
    } finally {
      Object.defineProperty(globalThis, 'setInterval', {
        configurable: true,
        writable: true,
        value: real,
      })
    }
  })

  it('contributes the hooks the feature listens on, its ports and its links, but no UI surface', async () => {
    const plugin = resolved()
    const contribution = await plugin.contribute()

    expect((contribution.hooks ?? []).map((hook) => `${hook.phase}:${hook.name}`)).toEqual([
      `${EHookPhase.BeforeTurn}:follow-session`,
      `${EHookPhase.AfterTurn}:turn-ended`,
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
    ])
    expect((contribution.ports ?? []).map((binding) => binding.token)).toEqual([
      PullRequestPort,
      GithubUiBridgePort,
    ])
    expect(contribution.tools ?? []).toEqual([])

    await contribution.dispose?.()
  })

  it('hands back a dispose that stops the service it started', async () => {
    const contribution = await resolved().contribute()

    expect(contribution.dispose).toBeDefined()
    await contribution.dispose?.()
  })
})
