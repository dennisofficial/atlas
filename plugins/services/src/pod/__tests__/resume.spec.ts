import { describe, expect, it } from 'bun:test'

import { EKilledBy, EShellEndCause, EServiceStatus } from '@dltech/atlas-core'
import type { PodControl } from '@dltech/atlas-plugin-sdk'
import { ECallStatus } from '@dltech/atlas-protocol'

import { declaredServicesOf } from '../../core'
import { resumeDeclaredServices } from '../resume'
import { stateFor } from '../state'
import { controlOf, rig, startsOf, writeDeclared } from './support'

const DECLARED = ['services:', '  web:', '    command: listen', '    port: 3000'].join('\n')
const URL = 'https://3000-abc.byatlas.dev'

const control = (): PodControl => ({
  ...controlOf({ url: URL }),
  exposePort: async ({ port }) => ({
    url: `https://${port}-abc.byatlas.dev`,
    tunnelToken: 'tunnel-token',
  }),
})

const hashOf = (content: string, name: string): string => {
  const declared = declaredServicesOf(content)
  if (!declared.ok) throw new Error(declared.reason)
  const hash = declared.value.hashes.get(name)
  if (hash === undefined) throw new Error(`no hash for ${name}`)
  return hash
}

const declaredStarted = async (args: {
  harness: ReturnType<typeof rig>
  content: string
  serviceId?: string
}) => {
  const serviceId = args.serviceId ?? 'svc-old'
  await args.harness.ctx.append([
    {
      type: 'service-started',
      serviceId,
      command: 'listen',
      description: 'web',
      name: 'web',
      declarationHash: hashOf(args.content, 'web'),
      cwd: '/work',
      root: '/work',
      port: 3000,
      url: URL,
      bootId: 'b1',
    },
  ])
  return serviceId
}

const resume = async (harness: ReturnType<typeof rig>) => {
  await resumeDeclaredServices({ ctx: harness.ctx, state: stateFor(harness.ctx) })
}

describe('resuming declared services after a daemon restart', () => {
  it('ends the lost service and starts it again with the same port and url', async () => {
    const harness = rig({ control: control() })
    writeDeclared(harness, DECLARED)
    const serviceId = await declaredStarted({ harness, content: DECLARED })
    await resume(harness)

    expect(harness.notices).toMatchObject([
      {
        event: {
          type: 'service-ended',
          serviceId,
          cause: EShellEndCause.SandboxStopped,
          killedBy: EKilledBy.Unrecorded,
          status: EServiceStatus.Killed,
        },
        key: `service-ended:${serviceId}`,
      },
    ])
    expect(startsOf(harness.calls)).toMatchObject([{ command: 'listen', cwd: '/work', port: 3000 }])
    const started = harness.log.filter((event) => event.type === 'service-started')
    expect(started).toHaveLength(2)
    expect(started.at(-1)).toMatchObject({ name: 'web', port: 3000, url: URL })
  })

  it('ends a lost ad-hoc service and does not start it again', async () => {
    const harness = rig({ control: control() })
    await harness.ctx.append([
      { type: 'service-started', serviceId: 'svc-adhoc', command: 'bun dev', bootId: 'b1' },
    ])
    await resume(harness)

    expect(harness.notices).toMatchObject([
      { event: { type: 'service-ended', serviceId: 'svc-adhoc' } },
    ])
    expect(startsOf(harness.calls)).toEqual([])
  })

  it('resumes nothing when the daemon still lists the service', async () => {
    const harness = rig({ control: control() })
    writeDeclared(harness, DECLARED)
    await declaredStarted({ harness, content: DECLARED })
    const started = await harness.ctx.call({
      op: 'services.start',
      serviceId: 'svc-old',
      command: 'listen',
      cwd: '/work',
      port: 3000,
    })
    expect(started.status).toBe(ECallStatus.Ok)
    await resume(harness)

    expect(harness.notices).toEqual([])
    expect(startsOf(harness.calls)).toHaveLength(1)
  })

  it('leaves a service the declaration no longer names ended and alone', async () => {
    const harness = rig({ control: control() })
    const other = ['services:', '  api:', '    command: serve'].join('\n')
    writeDeclared(harness, other)
    await declaredStarted({ harness, content: DECLARED })
    await resume(harness)

    expect(harness.notices).toHaveLength(1)
    expect(startsOf(harness.calls)).toEqual([])
  })
})
