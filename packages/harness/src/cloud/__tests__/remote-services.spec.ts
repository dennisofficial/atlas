import { describe, expect, it } from 'bun:test'

import { EDeclaredServiceState, toThreadId } from '@dltech/atlas-core'
import { EClientRequest } from '../channel-wire'
import { EEnsureStatus } from '../../services/declared-ensure'

import { RemoteServiceRegistry } from '../remote-services'
import { createSharedRoster } from '../roster-reader'

const asked: { op: EClientRequest; params: unknown }[] = []

const registryAnswering = (answers: Partial<Record<EClientRequest, unknown>>) => {
  asked.length = 0
  const roster = createSharedRoster({
    roster: async () => ({ shells: [], agents: [], services: [] }),
    onChange: () => () => undefined,
  } as never)
  const channel = {
    async request(request: { op: EClientRequest; params: unknown }) {
      asked.push(request)
      return answers[request.op]
    },
  }
  return new RemoteServiceRegistry(roster, channel as never)
}

describe('RemoteServiceRegistry declared services', () => {
  it('reads the declared view through the channel', async () => {
    const registry = registryAnswering({
      [EClientRequest.ListDeclaredServices]: {
        ok: true,
        view: {
          services: [{ name: 'web', state: 'stopped', links: [] }],
          rejections: [],
        },
      },
    })

    const view = await registry.declared()

    expect(view.services[0]?.state).toBe(EDeclaredServiceState.Stopped)
    expect(asked).toEqual([{ op: EClientRequest.ListDeclaredServices, params: {} }])
  })

  it('starts a named service and maps the status', async () => {
    const registry = registryAnswering({
      [EClientRequest.EnsureDeclaredServices]: {
        ok: true,
        results: [{ name: 'web', status: 'started', links: [], ready: true }],
      },
    })

    const results = await registry.ensureDeclared({ threadId: toThreadId('t'), names: ['web'] })

    expect(results[0]?.status).toBe(EEnsureStatus.Started)
    expect(asked[0]).toEqual({
      op: EClientRequest.EnsureDeclaredServices,
      params: { names: ['web'] },
    })
  })

  it('throws the refusal reason when the sandbox refuses', async () => {
    const registry = registryAnswering({
      [EClientRequest.EnsureDeclaredServices]: { ok: false, reason: 'no registry' },
    })

    await expect(registry.ensureDeclared({ threadId: toThreadId('t') })).rejects.toThrow(
      'no registry',
    )
  })

  it('restarts by service id and reports a refusal', async () => {
    const registry = registryAnswering({
      [EClientRequest.RestartService]: { ok: false, reason: 'declaration removed' },
    })

    expect(await registry.restart({ serviceId: 'svc_1' })).toEqual({
      ok: false,
      reason: 'declaration removed',
    })
    expect(asked[0]).toEqual({ op: EClientRequest.RestartService, params: { serviceId: 'svc_1' } })
  })
})
