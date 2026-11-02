import { describe, expect, it } from 'bun:test'

import { deriveServicePort } from '@dltech/atlas-core'

import { EEnsureStatus } from '../declared-ensure'
import { open, THREAD } from './declared-fixture'

const YAML = `services:
  a:
    command: serve a
    env:
      WEB: \${services.b.publicUrl}
  b:
    command: serve b
    portal: true
`

const YAML_SELF = `services:
  a:
    command: serve a
    portal: true
    env:
      SELF: \${services.a.publicUrl}
`

describe('publicUrl references of services not yet started', () => {
  it('publishes the portal url without starting the target', async () => {
    const { registry, processes } = open({ yaml: YAML })

    const [a] = await registry.ensureDeclared({ threadId: THREAD, names: ['a'] })

    expect(a).toMatchObject({ name: 'a', status: EEnsureStatus.Started, ready: true })
    const started = processes.servicesStarted()
    expect(started.map((one) => one.cmd[2])).toEqual(['serve a'])
    const bPort = deriveServicePort({ name: 'b' })
    expect(started[0]?.env?.WEB).toBe(`https://${bPort}-x.byatlas.dev`)
    await registry.closeAll()
  })

  it('starting the target later reuses the published port and url', async () => {
    const { registry, processes } = open({ yaml: YAML })
    await registry.ensureDeclared({ threadId: THREAD, names: ['a'] })
    const published = processes.servicesStarted()[0]?.env?.WEB

    await registry.ensureDeclared({ threadId: THREAD, names: ['b'] })

    const b = processes.servicesStarted().find((one) => one.cmd[2] === 'serve b')
    expect(b?.env?.PORT).toBe(String(deriveServicePort({ name: 'b' })))
    expect(b?.env?.PUBLIC_URL).toBe(published)
    await registry.closeAll()
  })

  it('leaves the literal in place when exposure fails', async () => {
    const { registry, processes } = open({ yaml: YAML })
    processes.exposureFails = true

    const [a] = await registry.ensureDeclared({ threadId: THREAD, names: ['a'] })

    expect(a?.status).toBe(EEnsureStatus.Started)
    expect(processes.servicesStarted()[0]?.env?.WEB).toBe('${services.b.publicUrl}')
    await registry.closeAll()
  })

  it('resolves a publicUrl self-reference at launch', async () => {
    const { registry, processes } = open({ yaml: YAML_SELF })

    const [a] = await registry.ensureDeclared({ threadId: THREAD, names: ['a'] })

    expect(a?.status).toBe(EEnsureStatus.Started)
    const started = processes.servicesStarted()
    expect(started[0]?.env?.SELF).toBe(started[0]?.env?.PUBLIC_URL)
    await registry.closeAll()
  })
})
