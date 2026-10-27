import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { act } from 'react'

import { EClientRequest } from '@dltech/atlas-client/channel'
import { EChangeScope } from '@dltech/atlas-wire/web'

import type { GitChangesChannel } from '../git-changes-load'
import { EGitChangesStatus, useGitChanges, type GitChangesView } from '../use-git-changes'

beforeAll(() => {
  GlobalRegistrator.register()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(async () => {
  await GlobalRegistrator.unregister()
})

function fakeChannel(options: { fail?: boolean } = {}) {
  const scopes: string[] = []
  const channel: GitChangesChannel = {
    request: async ({ op, params }) => {
      if (op !== EClientRequest.ReadGitChanges) throw new Error('unexpected op')
      if (options.fail) throw new Error('git is unavailable')
      const scope = (params as { scope: string }).scope
      scopes.push(scope)
      return { scope, base: null, files: [], truncated: scope === EChangeScope.LastCommit }
    },
  }
  return { channel, scopes }
}

type Props = { channel: GitChangesChannel | null; scope: EChangeScope; working: boolean }

async function mount(initial: Props) {
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.createElement('div'))
  let latest: GitChangesView | null = null
  function Probe(props: Props) {
    latest = useGitChanges(props).view
    return null
  }
  await act(async () => root.render(<Probe {...initial} />))
  const update = async (next: Props) => act(async () => root.render(<Probe {...next} />))
  return {
    update,
    view: () => {
      if (latest === null) throw new Error('the probe never rendered')
      return latest
    },
  }
}

describe('useGitChanges', () => {
  it('stays loading without a channel', async () => {
    const probe = await mount({ channel: null, scope: EChangeScope.All, working: false })
    expect(probe.view().status).toBe(EGitChangesStatus.Loading)
  })

  it('loads the scope on mount and carries the truncated flag', async () => {
    const { channel, scopes } = fakeChannel()
    const probe = await mount({ channel, scope: EChangeScope.LastCommit, working: false })
    expect(scopes).toEqual(['last-commit'])
    const view = probe.view()
    expect(view.status).toBe(EGitChangesStatus.Ready)
    if (view.status === EGitChangesStatus.Ready) expect(view.truncated).toBe(true)
  })

  it('refetches when the scope changes', async () => {
    const { channel, scopes } = fakeChannel()
    const probe = await mount({ channel, scope: EChangeScope.All, working: false })
    await probe.update({ channel, scope: EChangeScope.Uncommitted, working: false })
    expect(scopes).toEqual(['all', 'uncommitted'])
  })

  it('refetches when working goes from true to false, not on false to true', async () => {
    const { channel, scopes } = fakeChannel()
    const probe = await mount({ channel, scope: EChangeScope.All, working: true })
    expect(scopes).toHaveLength(1)
    await probe.update({ channel, scope: EChangeScope.All, working: false })
    expect(scopes).toHaveLength(2)
    await probe.update({ channel, scope: EChangeScope.All, working: true })
    expect(scopes).toHaveLength(2)
  })

  it('reports a failed read with its message', async () => {
    const { channel } = fakeChannel({ fail: true })
    const probe = await mount({ channel, scope: EChangeScope.All, working: false })
    expect(probe.view()).toEqual({
      status: EGitChangesStatus.Failed,
      message: 'git is unavailable',
    })
  })
})
