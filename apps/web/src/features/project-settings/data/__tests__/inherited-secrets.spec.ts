import { describe, expect, it } from 'bun:test'

import { ESecretKind } from '@dltech/atlas-wire/web'

import type { ListedSecret } from '@/features/settings/data/workspace/resource-api'
import type { WorkspaceAccess } from '@/features/settings/data/workspace/use-workspace-access'
import { CloudApiError } from '@/lib/cloud-api'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { inheritedViewOf } from '../inherited-secrets'

const noop = () => undefined
const loading = {
  state: EQueryState.Loading,
  data: undefined,
  error: undefined,
  reload: noop,
} as const
const failed = (reload: () => void) =>
  ({
    state: EQueryState.Failed,
    data: undefined,
    error: new CloudApiError({ message: 'down', status: 503 }),
    reload,
  }) as const
const ready = <T>(data: T): CloudQuery<T> => ({
  state: EQueryState.Ready,
  data,
  error: undefined,
  reload: noop,
})

const secret: ListedSecret = {
  name: 'A',
  kind: ESecretKind.Secret,
  value: 'v',
  createdAt: 'x',
  updatedAt: 'x',
  updatedBy: null,
}
const access = ready<WorkspaceAccess | null>(null)

describe('inheritedViewOf', () => {
  it('is loading while access or the workspace list loads', () => {
    expect(inheritedViewOf({ access: loading, inherited: ready([]) }).state).toBe(
      EQueryState.Loading,
    )
    expect(inheritedViewOf({ access, inherited: loading }).state).toBe(EQueryState.Loading)
  })

  it('surfaces an access failure with its retry', () => {
    let retried = 0
    const view = inheritedViewOf({ access: failed(() => (retried += 1)), inherited: ready([]) })
    expect(view).toMatchObject({ state: EQueryState.Failed, message: 'down' })
    if (view.state === EQueryState.Failed) view.retry()
    expect(retried).toBe(1)
  })

  it('surfaces a workspace secrets failure with its retry', () => {
    let retried = 0
    const view = inheritedViewOf({ access, inherited: failed(() => (retried += 1)) })
    expect(view).toMatchObject({ state: EQueryState.Failed, message: 'down' })
    if (view.state === EQueryState.Failed) view.retry()
    expect(retried).toBe(1)
  })

  it('keeps an empty workspace distinct from a failure', () => {
    expect(inheritedViewOf({ access, inherited: ready([]) })).toEqual({
      state: EQueryState.Ready,
      secrets: [],
    })
    expect(inheritedViewOf({ access, inherited: ready([secret]) })).toEqual({
      state: EQueryState.Ready,
      secrets: [secret],
    })
  })
})
