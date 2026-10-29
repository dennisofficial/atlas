import { describe, expect, it } from 'bun:test'

import { NoticePort, toThreadId } from '@dltech/atlas-core'
import { POD_INGRESS_HOST_PORT_ENV, POD_NAME_ENV } from '@dltech/atlas-harness'

import type { ServeComposeArgs } from '../serve-app'
import { exposerFor } from '../serve-port-exposer'

class QuietNotice extends NoticePort {
  notify(): void {}
}

const composeArgs = (env: Record<string, string | undefined>): ServeComposeArgs => ({
  threadId: toThreadId('thread-1'),
  cwd: '/workspace',
  controlPlaneUrl: 'https://cloud.example',
  token: 'tok',
  clientVersion: '1.0.0',
  env,
  model: undefined,
  notice: new QuietNotice(),
})

describe('exposerFor in a local pod', () => {
  it('answers with the loopback ingress url for the exposed port', async () => {
    const exposer = exposerFor(
      composeArgs({
        [POD_NAME_ENV]: 'atlas-pod-a',
        [POD_INGRESS_HOST_PORT_ENV]: '23457',
      }),
    )
    expect(await exposer?.exposePort({ port: 5173 })).toBe('http://5173.sandbox.localhost:23457')
  })

  it('prefers the pod ingress over API provisioning', async () => {
    const exposer = exposerFor(
      composeArgs({
        [POD_NAME_ENV]: 'atlas-pod-a',
        [POD_INGRESS_HOST_PORT_ENV]: '23457',
        ATLAS_API_PROVISIONED: '1',
      }),
    )
    expect(await exposer?.exposePort({ port: 3000 })).toBe('http://3000.sandbox.localhost:23457')
  })

  it('has no exposer when the ingress port is missing or invalid', () => {
    for (const ingress of [undefined, '', 'abc', '0', '70000']) {
      expect(
        exposerFor(
          composeArgs({
            [POD_NAME_ENV]: 'atlas-pod-a',
            [POD_INGRESS_HOST_PORT_ENV]: ingress,
          }),
        ),
      ).toBeNull()
    }
  })
})
