import { describe, expect, it } from 'bun:test'

import { ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'

import { REFUSAL_SERVICE_ACTION, REFUSAL_SERVICE_TARGET, service, serviceArgs } from '../commands'

const argsOf = (argumentText: string): TextArgs =>
  service.spec.fromText?.(argumentText) ?? { ok: false, reason: 'no fromText' }

describe('the service command', () => {
  it('is a host command in the session group', () => {
    expect(service.spec.name).toBe('service')
    expect(service.spec.group).toBe(ECommandGroup.Session)
    expect(service.spec.runsIn).toBe(ECommandRunsIn.Host)
    expect(service.inboxKind).toBe('command:service')
  })

  it('reads stop and a service id', () => {
    expect(argsOf(' stop svc-1 ')).toEqual({
      ok: true,
      args: { action: 'stop', serviceId: 'svc-1' },
    })
  })

  it('reads restart and a service id', () => {
    expect(argsOf('restart svc-1')).toEqual({
      ok: true,
      args: { action: 'restart', serviceId: 'svc-1' },
    })
  })

  it('refuses an action it does not take', () => {
    expect(argsOf('start svc-1')).toEqual({ ok: false, reason: REFUSAL_SERVICE_ACTION })
    expect(argsOf('kill svc-1')).toEqual({ ok: false, reason: REFUSAL_SERVICE_ACTION })
    expect(argsOf('')).toEqual({ ok: false, reason: REFUSAL_SERVICE_ACTION })
  })

  it('refuses an action with no service named', () => {
    expect(argsOf('stop')).toEqual({ ok: false, reason: REFUSAL_SERVICE_TARGET })
  })

  it('refuses more than an action and an id', () => {
    expect(argsOf('stop svc-1 now')).toEqual({ ok: false, reason: REFUSAL_SERVICE_ACTION })
  })

  it('refuses a payload without a service id', () => {
    expect(serviceArgs.safeParse({ action: 'stop', serviceId: '' }).success).toBe(false)
    expect(serviceArgs.safeParse({ action: 'list' }).success).toBe(false)
  })
})
