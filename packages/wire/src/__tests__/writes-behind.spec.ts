import { describe, expect, it } from 'bun:test'

import {
  API_PROVISIONED_ENV,
  isLocalPod,
  mirrorsThreadState,
  writesBehind,
} from '../boot-progress-wire'

describe('writesBehind', () => {
  it('holds for an api-provisioned pod and for any pod told a url and a token', () => {
    expect(writesBehind({ [API_PROVISIONED_ENV]: '1' })).toBe(true)
    expect(
      writesBehind({ ATLAS_CLOUD_URL: 'https://api.example.com', ATLAS_SERVE_TOKEN: 't' }),
    ).toBe(true)
  })

  it('does not hold without both a url and a token', () => {
    expect(writesBehind({})).toBe(false)
    expect(writesBehind({ ATLAS_CLOUD_URL: 'https://api.example.com' })).toBe(false)
    expect(writesBehind({ ATLAS_SERVE_TOKEN: 't' })).toBe(false)
    expect(writesBehind({ ATLAS_CLOUD_URL: ' ', ATLAS_SERVE_TOKEN: 't' })).toBe(false)
  })
})

describe('isLocalPod', () => {
  it('holds only for a present, non-blank pod name', () => {
    expect(isLocalPod({ ATLAS_POD_NAME: 'atlas-pod-1' })).toBe(true)
    expect(isLocalPod({})).toBe(false)
    expect(isLocalPod({ ATLAS_POD_NAME: '  ' })).toBe(false)
    expect(isLocalPod({ ATLAS_POD_NAME: '' })).toBe(false)
  })
})

describe('mirrorsThreadState', () => {
  const remote = { ATLAS_CLOUD_URL: 'https://api.example.com', ATLAS_SERVE_TOKEN: 't' }

  it('holds for a cloud pod that writes behind', () => {
    expect(mirrorsThreadState(remote)).toBe(true)
    expect(mirrorsThreadState({ [API_PROVISIONED_ENV]: '1' })).toBe(true)
  })

  it('never holds for a local pod, even with a url and a token', () => {
    expect(mirrorsThreadState({ ...remote, ATLAS_POD_NAME: 'atlas-pod-1' })).toBe(false)
  })

  it('does not hold when nothing writes behind', () => {
    expect(mirrorsThreadState({})).toBe(false)
  })
})
