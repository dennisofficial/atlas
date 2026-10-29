import { describe, expect, it } from 'bun:test'

import {
  EServeEnv,
  FORBIDDEN_POD_ENV_KEYS,
  POD_ENV_IDENTITY_KEYS,
  POD_INGRESS_HOST_PORT_ENV,
} from '@dltech/atlas-wire'

import { DEFAULT_POD_IMAGE, podCreateBody, type PodCreateArgs } from '../pod-create'

const TELEMETRY_ID = '3f2b8c1e-6a4d-4e0f-9b7a-2c5d8e1f0a3b'

const baseArgs: PodCreateArgs = {
  threadId: 'thread-1',
  home: '/home/test/.atlas',
  image: DEFAULT_POD_IMAGE,
  serveHostPort: 23_456,
  ingressHostPort: 23_457,
  vcpus: 2,
  token: 'serve-token',
  cloudUrl: 'https://cloud.example',
  environment: {},
}

const envOf = (args: PodCreateArgs): Record<string, string> =>
  Object.fromEntries(
    (podCreateBody(args).Env ?? []).map((entry) => {
      const index = entry.indexOf('=')
      return [entry.slice(0, index), entry.slice(index + 1)]
    }),
  )

describe('local pod env contract', () => {
  it('sets only contract-listed env keys', () => {
    const keys = Object.keys(
      envOf({
        ...baseArgs,
        pinnedModel: 'x',
        environment: { ATLAS_TELEMETRY_IDENTITY: TELEMETRY_ID },
      }),
    )

    expect(keys.filter((key) => !POD_ENV_IDENTITY_KEYS.includes(key))).toEqual([])
  })

  it('sets no forbidden settings env, even when the caller passes one', () => {
    const env = envOf({
      ...baseArgs,
      environment: { ATLAS_CLASSIFIER_MODE: 'y', ATLAS_DECISIONS_URL: 'z' },
    })

    expect(Object.keys(env).filter((key) => FORBIDDEN_POD_ENV_KEYS.includes(key))).toEqual([])
  })

  it('keeps its own plumbing when the caller passes the same keys', () => {
    const env = envOf({
      ...baseArgs,
      environment: {
        [EServeEnv.Token]: 'hostile-token',
        [EServeEnv.ThreadId]: 'other-thread',
        [EServeEnv.CloudUrl]: 'https://evil.example',
        ATLAS_HOME: '/tmp',
        [POD_INGRESS_HOST_PORT_ENV]: '1',
      },
    })

    expect(env).toMatchObject({
      [EServeEnv.Token]: 'serve-token',
      [EServeEnv.ThreadId]: 'thread-1',
      [EServeEnv.CloudUrl]: 'https://cloud.example',
      ATLAS_HOME: '/atlas/home',
      [POD_INGRESS_HOST_PORT_ENV]: '23457',
    })
  })
})
