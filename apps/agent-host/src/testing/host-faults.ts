import { ControlPlane, RecordCorruptError } from '@dltech/atlas-control'
import type { LogPort } from '@dltech/atlas-observability'
import { INBOX_KIND_MESSAGE } from '@dltech/atlas-protocol'

import type { SandboxProvider } from '../sandbox/sandbox-provider'

export enum EHostFault {
  TurnThrowsOnce = 'turn-throws-once',
  RevokeThrowsTwice = 'revoke-throws-twice',
  SandboxStopThrowsOnce = 'sandbox-stop-throws-once',
  PostDuringRevoke = 'post-during-revoke',
  SpyWake = 'spy-wake',
  CommandOutcomeHangs = 'command-outcome-hangs',
}

export const hostFaultOf = (raw: string | undefined): EHostFault | undefined => {
  if (raw === undefined || raw === '') return undefined
  const found = Object.values(EHostFault).find((fault) => fault === raw)
  if (found === undefined) throw new Error(`FAULT is not a known fault: ${raw}`)
  return found
}

type Append = ControlPlane['append']
type Revoke = (
  params: Parameters<ControlPlane['revoke']>[0] & { epoch: number },
) => Promise<unknown>

const announce = (args: { log: LogPort; message: string }): void =>
  args.log.info({ source: 'host-fault', message: args.message })

const turnThrowsOnce = (args: { plane: ControlPlane; log: LogPort }): Append => {
  let thrown = false
  return async (params) => {
    if (thrown) return args.plane.append(params)
    thrown = true
    announce({ log: args.log, message: 'fault: turn append throws' })
    throw new RecordCorruptError('injected turn fault')
  }
}

const COMMAND_OUTCOME_TYPES: readonly string[] = ['history-rewound', 'history-summarised']

const commandOutcomeHangs = (args: { plane: ControlPlane; log: LogPort }): Append => {
  return async (params) => {
    const isOutcome = params.events.some(
      (event) =>
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        typeof event.type === 'string' &&
        COMMAND_OUTCOME_TYPES.includes(event.type),
    )
    if (!isOutcome) return args.plane.append(params)
    announce({ log: args.log, message: 'fault: command outcome hangs' })
    return new Promise<never>(() => {})
  }
}

const revokeThrowsTwice = (args: { plane: ControlPlane; log: LogPort }): Revoke => {
  let thrown = 0
  return async (params) => {
    if (thrown >= 2) return args.plane.revoke(params)
    thrown += 1
    announce({ log: args.log, message: `fault: revoke throws ${thrown}` })
    throw new Error('injected revoke failure')
  }
}

const postDuringRevoke = (args: { plane: ControlPlane; log: LogPort }): Revoke => {
  let posted = false
  return async (params) => {
    if (!posted) {
      posted = true
      await args.plane.post({
        sessionId: params.sessionId,
        kind: INBOX_KIND_MESSAGE,
        payload: JSON.stringify({ text: 'late message' }),
      })
      announce({ log: args.log, message: 'fault: posted during revoke' })
    }
    return args.plane.revoke(params)
  }
}

const overridesOf = (args: {
  plane: ControlPlane
  fault: EHostFault
  log: LogPort
}): Record<string, unknown> => {
  const { plane, fault, log } = args
  const spyWake = {
    wake: (params: Parameters<ControlPlane['wake']>[0]) => {
      announce({ log, message: 'fault: plane.wake called' })
      return plane.wake(params)
    },
  }
  if (fault === EHostFault.TurnThrowsOnce) return { ...spyWake, append: turnThrowsOnce(args) }
  if (fault === EHostFault.CommandOutcomeHangs) {
    return { ...spyWake, append: commandOutcomeHangs(args) }
  }
  if (fault === EHostFault.RevokeThrowsTwice) return { ...spyWake, revoke: revokeThrowsTwice(args) }
  if (fault === EHostFault.PostDuringRevoke) return { ...spyWake, revoke: postDuringRevoke(args) }
  return spyWake
}

export const faultedPlane = (args: {
  plane: ControlPlane
  fault: EHostFault | undefined
  log: LogPort
}): ControlPlane => {
  if (args.fault === undefined) return args.plane
  const overrides = overridesOf({ plane: args.plane, fault: args.fault, log: args.log })
  return new Proxy(args.plane, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in overrides) return overrides[prop]
      const value: unknown = Reflect.get(target, prop)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export const faultSandbox = (args: {
  sandbox: SandboxProvider
  fault: EHostFault | undefined
  log: LogPort
}): void => {
  if (args.fault !== EHostFault.SandboxStopThrowsOnce) return
  const { sandbox, log } = args
  const stop = sandbox.stop.bind(sandbox)
  let thrown = false
  sandbox.stop = async (params) => {
    if (thrown) return stop(params)
    thrown = true
    announce({ log, message: 'fault: sandbox.stop throws' })
    throw new Error('injected sandbox stop failure')
  }
}
