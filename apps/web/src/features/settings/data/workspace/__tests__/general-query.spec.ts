import { describe, expect, it } from 'vitest'

import { CloudApiError } from '@/lib/cloud-api'
import { EQueryState, type CloudQuery } from '@/lib/use-cloud-query'

import { combineGeneralQueries } from '../general-query'

const failed = (reload: () => void): CloudQuery<string> => ({
  state: EQueryState.Failed,
  data: undefined,
  error: new CloudApiError({ message: 'boom', status: 500 }),
  reload,
})

const ready = (data: string): CloudQuery<string> => ({
  state: EQueryState.Ready,
  data,
  error: undefined,
  reload: () => undefined,
})

const build = ({ details, settings }: { details: string; settings: string }) =>
  `${details}+${settings}`

describe('combineGeneralQueries', () => {
  it('retry reloads both queries when the details query failed', () => {
    const reloaded: string[] = []
    const combined = combineGeneralQueries({
      details: failed(() => reloaded.push('details')),
      settings: ready('s'),
      reload: () => reloaded.push('details', 'settings'),
      build,
    })
    expect(combined.state).toBe(EQueryState.Failed)
    combined.reload()
    expect(reloaded).toEqual(['details', 'settings'])
  })

  it('retry reloads both queries when the settings query failed', () => {
    const reloaded: string[] = []
    const combined = combineGeneralQueries({
      details: ready('d'),
      settings: failed(() => reloaded.push('settings-only')),
      reload: () => reloaded.push('details', 'settings'),
      build,
    })
    expect(combined.state).toBe(EQueryState.Failed)
    combined.reload()
    expect(reloaded).toEqual(['details', 'settings'])
  })

  it('builds once both are ready', () => {
    const combined = combineGeneralQueries({
      details: ready('d'),
      settings: ready('s'),
      reload: () => undefined,
      build,
    })
    expect(combined).toMatchObject({ state: EQueryState.Ready, data: 'd+s' })
  })
})
