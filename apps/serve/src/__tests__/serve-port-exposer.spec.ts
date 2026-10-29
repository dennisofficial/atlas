import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'

import type { ServeComposeArgs } from '../serve-app'
import { exposerFor } from '../serve-port-exposer'

const composeArgs = (env: Record<string, string | undefined>): ServeComposeArgs => {
  const args: Pick<
    ServeComposeArgs,
    'threadId' | 'cwd' | 'controlPlaneUrl' | 'token' | 'clientVersion' | 'env'
  > = {
    threadId: toThreadId('pod-thread'),
    cwd: '/atlas/workspaces/repo',
    controlPlaneUrl: 'https://api.example.com',
    token: 'serve-token',
    clientVersion: '1.2.3',
    env,
  }
  return args as ServeComposeArgs
}

describe('exposerFor', () => {
  it('gives a local Docker pod (no Vercel credentials, not API-provisioned) a working exposer', () => {
    const exposer = exposerFor(
      composeArgs({
        ATLAS_POD_NAME: 'atlas-pod-1',
        ATLAS_CLOUD_URL: 'https://api.example.com',
        ATLAS_SERVE_TOKEN: 'serve-token',
      }),
    )

    expect(exposer).not.toBeNull()
  })

  it('gives an API-provisioned sandbox the same exposer', () => {
    expect(exposerFor(composeArgs({ ATLAS_API_PROVISIONED: '1' }))).not.toBeNull()
  })

  it('is null only when the control plane is absent', () => {
    const args = { ...composeArgs({}), controlPlaneUrl: '', token: '' }

    expect(exposerFor(args)).toBeNull()
  })
})
