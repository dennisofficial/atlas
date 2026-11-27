import { describe, expect, it } from 'bun:test'

import {
  apiResourceReducer,
  EResourceAction,
  EResourceState,
  initialApiResourceState,
} from '../api-resource-state'

describe('apiResourceReducer', () => {
  it('starts loading with no data', () => {
    expect(initialApiResourceState<string>()).toEqual({ state: EResourceState.Loading, data: null })
  })

  it('keeps the loaded data while it reloads', () => {
    const ready = apiResourceReducer(initialApiResourceState<string>(), {
      type: EResourceAction.Loaded,
      data: 'first',
    })
    expect(ready).toEqual({ state: EResourceState.Ready, data: 'first' })
    expect(apiResourceReducer(ready, { type: EResourceAction.Started })).toEqual({
      state: EResourceState.Loading,
      data: 'first',
    })
  })

  it('keeps the last data on a failure', () => {
    const ready = apiResourceReducer(initialApiResourceState<string>(), {
      type: EResourceAction.Loaded,
      data: 'first',
    })
    expect(apiResourceReducer(ready, { type: EResourceAction.Failed })).toEqual({
      state: EResourceState.Failed,
      data: 'first',
    })
  })

  it('replaces the data on a later load', () => {
    const ready = apiResourceReducer(initialApiResourceState<string>(), {
      type: EResourceAction.Loaded,
      data: 'first',
    })
    expect(apiResourceReducer(ready, { type: EResourceAction.Loaded, data: 'second' })).toEqual({
      state: EResourceState.Ready,
      data: 'second',
    })
  })
})
