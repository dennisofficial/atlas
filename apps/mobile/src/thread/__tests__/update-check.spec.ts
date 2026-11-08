import { describe, expect, it } from 'bun:test'

import {
  checkForUpdate,
  EUpdateStage,
  restartApp,
  STALE_TITLE,
  updateCardView,
  type UpdatesClient,
} from '../data/update-check'

const fakeClient = (overrides: Partial<UpdatesClient>): UpdatesClient & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    check: async () => {
      calls.push('check')
      return { isAvailable: true }
    },
    fetch: async () => {
      calls.push('fetch')
    },
    reload: async () => {
      calls.push('reload')
    },
    ...overrides,
  }
}

describe('checkForUpdate', () => {
  it('fetches an available update and reports it ready without reloading', async () => {
    const client = fakeClient({})
    expect(await checkForUpdate({ client })).toBe(EUpdateStage.Ready)
    expect(client.calls).toEqual(['check', 'fetch'])
  })

  it('reports no update when none is available and fetches nothing', async () => {
    const client = fakeClient({ check: async () => ({ isAvailable: false }) })
    expect(await checkForUpdate({ client })).toBe(EUpdateStage.NoUpdate)
    expect(client.calls).toEqual([])
  })

  it('reports a failed check when the check throws', async () => {
    const client = fakeClient({
      check: async () => {
        throw new Error('offline')
      },
    })
    expect(await checkForUpdate({ client })).toBe(EUpdateStage.Failed)
  })

  it('reports a failed check when the download throws', async () => {
    const client = fakeClient({
      fetch: async () => {
        throw new Error('disk full')
      },
    })
    expect(await checkForUpdate({ client })).toBe(EUpdateStage.Failed)
  })
})

describe('restartApp', () => {
  it('reloads the app', async () => {
    const client = fakeClient({})
    await restartApp({ client })
    expect(client.calls).toEqual(['reload'])
  })

  it('reports failure when the reload throws', async () => {
    const client = fakeClient({
      reload: async () => {
        throw new Error('nope')
      },
    })
    expect(await restartApp({ client })).toBe(EUpdateStage.Failed)
  })
})

describe('updateCardView', () => {
  it('offers the check with no detail before anything ran', () => {
    expect(updateCardView(EUpdateStage.Idle)).toEqual({
      detail: null,
      actionLabel: 'Check for updates',
    })
    expect(STALE_TITLE).toBe('A newer Atlas wrote this session.')
  })

  it('says the update is ready and offers a restart', () => {
    expect(updateCardView(EUpdateStage.Ready)).toEqual({
      detail: 'Update ready — restart to finish',
      actionLabel: 'Restart',
    })
  })

  it('says no update has been released yet', () => {
    expect(updateCardView(EUpdateStage.NoUpdate).detail).toBe(
      'No update has been released yet. Try again in a few minutes.',
    )
  })

  it('says the check failed', () => {
    expect(updateCardView(EUpdateStage.Failed).detail).toBe('The update check failed.')
  })
})
