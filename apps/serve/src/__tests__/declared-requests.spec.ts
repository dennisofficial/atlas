import { describe, expect, it } from 'bun:test'
import {
  EDeclaredServiceState,
  EServiceStatus,
  type DeclaredServicesView,
} from '@dltech/atlas-core'
import { EEnsureStatus, EClientFrame } from '@dltech/atlas-harness'
import {
  declaredServiceStateWire,
  declaredServicesViewWireSchema,
  EClientRequest,
  ensureDeclaredServicesReplySchema,
  restartServiceReplySchema,
} from '@dltech/atlas-wire'

import { answerProcessRequest } from '../process-requests'
import type { RequestFrame } from '../request-reply'

import { fakeProcesses, SERVICE, threadId } from './process-requests-fixture'

const request = (args: { op: EClientRequest; params: unknown }): RequestFrame => ({
  kind: EClientFrame.Request,
  id: 'r-1',
  ...args,
})

const VIEW: DeclaredServicesView = {
  services: [
    {
      name: 'web',
      state: EDeclaredServiceState.Running,
      serviceId: 'svc-1',
      links: [{ url: 'https://p.example', title: 'Web' }],
    },
  ],
  rejections: [],
}

describe('declared service requests', () => {
  it('keeps the wire state values identical to core', () => {
    expect([...declaredServiceStateWire.options].sort()).toEqual(
      Object.values(EDeclaredServiceState).sort(),
    )
  })

  it('answers the declared view in a shape the wire accepts', async () => {
    const processes = fakeProcesses({ services: { declared: async () => VIEW } })

    const reply = await answerProcessRequest({
      frame: request({ op: EClientRequest.ListDeclaredServices, params: {} }),
      threadId,
      processes,
    })

    expect(reply.data).toEqual({ ok: true, view: VIEW })
    expect(
      declaredServicesViewWireSchema.safeParse((reply.data as { view: unknown }).view).success,
    ).toBe(true)
  })

  it('reports a registry without a declared view as a refusal reply', async () => {
    const reply = await answerProcessRequest({
      frame: request({ op: EClientRequest.ListDeclaredServices, params: {} }),
      threadId,
      processes: fakeProcesses({}),
    })

    expect(reply.data).toMatchObject({ ok: false })
  })

  it('ensures the named services under the served thread', async () => {
    const seen: unknown[] = []
    const processes = fakeProcesses({
      services: {
        ensureDeclared: async (args) => {
          seen.push(args)
          return [{ name: 'web', status: EEnsureStatus.Started, links: [], ready: true }]
        },
      },
    })

    const reply = await answerProcessRequest({
      frame: request({ op: EClientRequest.EnsureDeclaredServices, params: { names: ['web'] } }),
      threadId,
      processes,
    })

    expect(seen).toEqual([{ threadId, names: ['web'] }])
    expect(ensureDeclaredServicesReplySchema.parse(reply.data)).toMatchObject({ ok: true })
  })

  it('refuses ensure params that are malformed and a registry that cannot ensure', async () => {
    const malformed = await answerProcessRequest({
      frame: request({ op: EClientRequest.EnsureDeclaredServices, params: { names: 'web' } }),
      threadId,
      processes: fakeProcesses({}),
    })
    const unsupported = await answerProcessRequest({
      frame: request({ op: EClientRequest.EnsureDeclaredServices, params: {} }),
      threadId,
      processes: fakeProcesses({}),
    })

    expect(malformed.data).not.toHaveProperty('ok')
    expect(unsupported.data).toMatchObject({ ok: false })
  })

  it('restarts a service by id and relays the outcome', async () => {
    const seen: string[] = []
    const processes = fakeProcesses({
      services: {
        restart: async ({ serviceId }) => {
          seen.push(serviceId)
          return { ok: true, snapshot: { ...SERVICE, status: EServiceStatus.Running } }
        },
      },
    })

    const reply = await answerProcessRequest({
      frame: request({ op: EClientRequest.RestartService, params: { serviceId: 'svc-1' } }),
      threadId,
      processes,
    })

    expect(seen).toEqual(['svc-1'])
    expect(restartServiceReplySchema.parse(reply.data)).toMatchObject({ ok: true })
  })

  it('relays a failed restart and refuses a registry without restart', async () => {
    const failed = await answerProcessRequest({
      frame: request({ op: EClientRequest.RestartService, params: { serviceId: 'svc-1' } }),
      threadId,
      processes: fakeProcesses({
        services: { restart: async () => ({ ok: false, reason: 'declaration removed' }) },
      }),
    })
    const unsupported = await answerProcessRequest({
      frame: request({ op: EClientRequest.RestartService, params: { serviceId: 'svc-1' } }),
      threadId,
      processes: fakeProcesses({}),
    })

    expect(failed.data).toEqual({ ok: false, reason: 'declaration removed' })
    expect(unsupported.data).toMatchObject({ ok: false })
  })
})
