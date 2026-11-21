import { describe, expect, it } from 'bun:test'

import { daemonToken } from '@dltech/atlas-protocol/engine'

import { agent37CreateBodyOf } from '../agent37-create'
import { agent37InstanceNameOf, type Agent37Env } from '../agent37-instances'

const env: Agent37Env = {
  apiKey: 'sk_live_test',
  template: 'atlas-sandbox@3',
  resources: { cpu: 2, memory: 4, disk: 20 },
}

describe('agent37CreateBodyOf', () => {
  const body = agent37CreateBodyOf({
    env,
    podSessionId: 'pod-1',
    sandboxName: agent37InstanceNameOf('pod-1'),
    token: daemonToken({ secret: 'secret', sandboxName: agent37InstanceNameOf('pod-1') }),
    bundleUrl: 'https://api.byatlas.io/agent/daemon/bundle',
  })

  it('asks for a vm with the platform shape, an /atlas mount and the 1800s auto-sleep', () => {
    expect(body.type).toBe('vm')
    expect(body.region).toBe('us')
    expect(body.resources).toEqual({ cpu: 2, memory: 4, disk: 20 })
    expect(body.mount_path).toBe('/atlas')
    expect(body.auto_sleep).toBe(true)
    expect(body.idle_timeout_seconds).toBe(1800)
  })

  it('creates from the registered template named by env and labels the pod session', () => {
    expect(body.template).toBe('atlas-sandbox@3')
    expect(body.name).toBe('atlas-pod-1')
    expect(body.metadata).toEqual({ atlasPodSessionId: 'pod-1' })
  })

  it('boots the daemon from env alone, since exec carries no per-call env', () => {
    expect(body.env.DAEMON_TOKEN).toBe(
      daemonToken({ secret: 'secret', sandboxName: 'atlas-pod-1' }),
    )
    expect(body.env.ATLAS_SANDBOX_NAME).toBe('atlas-pod-1')
    expect(body.env.ATLAS_DAEMON_PORT).toBe('47300')
    expect(body.env.PORT).toBeUndefined()
    expect(body.env.ATLAS_DAEMON_BUNDLE_URL).toBe('https://api.byatlas.io/agent/daemon/bundle')
  })

  it('takes the shape of the requested vcpus, keeping the template disk', () => {
    const bigger = agent37CreateBodyOf({
      env,
      podSessionId: 'pod-1',
      sandboxName: agent37InstanceNameOf('pod-1'),
      token: 'unused',
      bundleUrl: 'https://api.byatlas.io/agent/daemon/bundle',
      vcpus: 4,
    })
    expect(bigger.resources).toEqual({ cpu: 4, memory: 8, disk: 20 })
  })

  it('never carries the workspace api key', () => {
    expect(JSON.stringify(body)).not.toContain(env.apiKey)
  })
})
