import { afterEach, describe, expect, it, spyOn } from 'bun:test'

import { NoticePort, toThreadId } from '@dltech/atlas-core'
import { API_PROVISIONED_ENV } from '@dltech/atlas-wire'

import type { ServeComposeArgs } from '../serve-app'
import { exposerFor } from '../serve-port-exposer'
import { trpcOk, trpcUrl } from './trpc-fake'

class QuietNotice extends NoticePort {
  notify(): void {}
}

const controlPlaneUrl = 'https://api.example.com'

const argsWith = (env: Record<string, string | undefined>): ServeComposeArgs => ({
  threadId: toThreadId('thread-1'),
  cwd: '/atlas/workspaces/workspace',
  controlPlaneUrl,
  token: 'serve-token',
  clientVersion: '1.2.3',
  env,
  model: undefined,
  notice: new QuietNotice(),
})

describe('exposerFor', () => {
  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore()
  })

  it('returns the pod ingress exposer when ATLAS_POD_INGRESS_HOST_PORT is set', async () => {
    const exposer = exposerFor(argsWith({ ATLAS_POD_INGRESS_HOST_PORT: '23457' }))

    expect(exposer).not.toBeNull()
    expect(await exposer?.exposePort({ port: 3000 })).toBe('http://3000.sandbox.localhost:23457')
  })

  it('lets the API-provisioned branch win over the ingress env', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
      trpcOk({ url: 'https://sb-1.vercel.run' })) as unknown as typeof fetch)
    const exposer = exposerFor(
      argsWith({ [API_PROVISIONED_ENV]: '1', ATLAS_POD_INGRESS_HOST_PORT: '23457' }),
    )

    const url = await exposer?.exposePort({ port: 3000 })

    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toContain(
      trpcUrl({ controlPlaneUrl, procedure: 'sandboxSelf.exposePort' }),
    )
    expect(url).toBe('https://sb-1.vercel.run')
    expect(url).not.toContain('sandbox.localhost')
  })

  it('ignores a malformed ingress port env', () => {
    expect(exposerFor(argsWith({ ATLAS_POD_INGRESS_HOST_PORT: 'not-a-port' }))).toBeNull()
    expect(exposerFor(argsWith({ ATLAS_POD_INGRESS_HOST_PORT: '70000' }))).toBeNull()
  })

  it('returns null with neither api provisioning, ingress env, nor vercel credentials', () => {
    expect(exposerFor(argsWith({}))).toBeNull()
  })
})
