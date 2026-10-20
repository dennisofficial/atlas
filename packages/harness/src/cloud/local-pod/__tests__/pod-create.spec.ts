import { describe, expect, it } from 'bun:test'

import { createHash } from 'node:crypto'

import { SANDBOX_HOME_PATH, SANDBOX_WORKSPACES_PATH } from '@dltech/atlas-wire'

import {
  DEFAULT_POD_IMAGE,
  dindVolumeNameFor,
  memoryReservationBytesFor,
  podCreateBody,
  podHomeDigestOf,
  podHomeLabel,
  podNameFor,
  podRoleLabel,
  podThreadLabel,
  workspaceVolumeNameFor,
  type PodCreateArgs,
} from '../pod-create'

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

describe('pod names', () => {
  it('derives a deterministic atlas-pod name from the thread id digest', () => {
    const digest = createHash('sha256').update('thread-1').digest('hex').slice(0, 24)

    expect(podNameFor({ threadId: 'thread-1' })).toBe(`atlas-pod-${digest}`)
    expect(podNameFor({ threadId: 'thread-1' })).toBe(podNameFor({ threadId: 'thread-1' }))
    expect(podNameFor({ threadId: 'thread-2' })).not.toBe(podNameFor({ threadId: 'thread-1' }))
  })

  it('names both volumes after the pod', () => {
    const name = podNameFor({ threadId: 'thread-1' })

    expect(workspaceVolumeNameFor({ threadId: 'thread-1' })).toBe(`${name}-workspace`)
    expect(dindVolumeNameFor({ threadId: 'thread-1' })).toBe(`${name}-docker`)
  })
})

describe('podCreateBody', () => {
  it('runs privileged under an init with sleep as the command', () => {
    const body = podCreateBody(baseArgs)

    expect(body.Image).toBe(DEFAULT_POD_IMAGE)
    expect(body.Cmd).toEqual(['sleep', 'infinity'])
    expect(body.HostConfig?.Privileged).toBe(true)
    expect(body.HostConfig?.Init).toBe(true)
  })

  it('mounts exactly the workspace and docker-storage volumes and uses no binds', () => {
    const hostConfig = podCreateBody(baseArgs).HostConfig

    expect(hostConfig?.Mounts).toEqual([
      { Type: 'volume', Source: workspaceVolumeNameFor({ threadId: 'thread-1' }), Target: SANDBOX_WORKSPACES_PATH },
      { Type: 'volume', Source: dindVolumeNameFor({ threadId: 'thread-1' }), Target: '/var/lib/docker' },
    ])
    expect(hostConfig).not.toHaveProperty('Binds')
  })

  it('sizes cpu by vcpus, reserves memory softly, and sets no hard memory cap', () => {
    const hostConfig = podCreateBody(baseArgs).HostConfig

    expect(hostConfig?.NanoCpus).toBe(2e9)
    expect(hostConfig?.MemoryReservation).toBe(2 * 2048 * 1024 * 1024)
    expect(memoryReservationBytesFor({ vcpus: 2 })).toBe(2 * 2048 * 1024 * 1024)
    expect(podCreateBody({ ...baseArgs, vcpus: 4 }).HostConfig?.MemoryReservation).toBe(4 * 2048 * 1024 * 1024)
    expect(hostConfig).not.toHaveProperty('Memory')
  })

  it('publishes serve and ingress on loopback only', () => {
    const body = podCreateBody(baseArgs)

    expect(body.HostConfig?.PortBindings).toEqual({
      '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '23456' }],
      '7676/tcp': [{ HostIp: '127.0.0.1', HostPort: '23457' }],
    })
    expect(body.ExposedPorts).toEqual({ '3000/tcp': {}, '7676/tcp': {} })
  })

  it('labels the pod with its thread, role and owning home', () => {
    const homeDigest = createHash('sha256').update('/home/test/.atlas').digest('hex').slice(0, 16)
    expect(podCreateBody(baseArgs).Labels).toEqual({
      [podThreadLabel]: 'thread-1',
      [podRoleLabel]: 'pod',
      [podHomeLabel]: homeDigest,
    })
    expect(podThreadLabel).toBe('atlas-pod.thread')
    expect(podRoleLabel).toBe('atlas-pod.role')
    expect(podHomeLabel).toBe('atlas-pod.home')
  })

  it('keeps the home label stable for one home and distinct across homes', () => {
    const prod = podHomeDigestOf({ home: '/home/test/.atlas' })
    expect(podCreateBody(baseArgs).Labels?.[podHomeLabel]).toBe(prod)
    expect(podCreateBody({ ...baseArgs, threadId: 'thread-2' }).Labels?.[podHomeLabel]).toBe(prod)
    expect(podHomeDigestOf({ home: '/home/test/.atlas-dev' })).not.toBe(prod)
  })

  it('carries the serve contract in the environment', () => {
    expect(envOf(baseArgs)).toEqual({
      ATLAS_SERVE_TOKEN: 'serve-token',
      ATLAS_SERVE_PORT: '3000',
      ATLAS_THREAD_ID: 'thread-1',
      ATLAS_CLOUD_URL: 'https://cloud.example',
      ATLAS_HOME: SANDBOX_HOME_PATH,
      ATLAS_POD_NAME: podNameFor({ threadId: 'thread-1' }),
    })
  })

  it('sets ATLAS_MODEL only when a model is pinned', () => {
    expect(envOf(baseArgs)).not.toHaveProperty('ATLAS_MODEL')
    expect(envOf({ ...baseArgs, pinnedModel: 'claude-opus' }).ATLAS_MODEL).toBe('claude-opus')
  })

  it('merges the caller environment last and drops every VERCEL_ key', () => {
    const env = envOf({
      ...baseArgs,
      environment: {
        EXTRA: 'value',
        ATLAS_HOME: '/override',
        VERCEL_TOKEN: 'secret',
        VERCEL_TEAM_ID: 'team',
        VERCEL_PROJECT_ID: 'project',
        VERCEL_OIDC_TOKEN: 'oidc',
      },
    })

    expect(env.EXTRA).toBe('value')
    expect(env.ATLAS_HOME).toBe('/override')
    expect(Object.keys(env).filter((key) => key.startsWith('VERCEL_'))).toEqual([])
  })
})
