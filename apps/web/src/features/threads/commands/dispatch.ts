import {
  ECommandEffect,
  ECommandTiming,
  resolveSubmission,
  unsupportedCommand,
  type CommandHandlers,
  type CommandSpec,
  type SurfaceCommand,
} from '@dltech/atlas-core'

export enum EDispatch {
  Ran = 'ran',
  Refused = 'refused',
  Send = 'send',
}

export type DispatchResult =
  | { type: EDispatch.Ran; notice?: string | undefined }
  | { type: EDispatch.Refused; reason: string }
  | { type: EDispatch.Send }

export const SETTLED_WHILE_WORKING = 'Wait for the turn to finish'

const SEND: DispatchResult = { type: EDispatch.Send }

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export async function dispatchSubmission(args: {
  text: string
  handlers: CommandHandlers
  commands: readonly SurfaceCommand[]
  skills: readonly CommandSpec[]
  working: boolean
}): Promise<DispatchResult> {
  const unsupported = unsupportedCommand({
    text: args.text,
    handlers: args.handlers,
    skills: args.skills,
  })
  if (unsupported !== null) {
    return {
      type: EDispatch.Refused,
      reason: `/${unsupported.name} isn't available in the browser`,
    }
  }

  const { local } = resolveSubmission({
    text: args.text,
    specs: [...args.commands, ...args.skills],
  })
  if (local === null) return SEND

  const command = args.commands.find((candidate) => candidate.name === local.spec.name)
  if (command === undefined) return SEND

  if (command.timing === ECommandTiming.Settled && args.working) {
    return { type: EDispatch.Refused, reason: SETTLED_WHILE_WORKING }
  }

  try {
    const effect = await command.run({ argumentText: local.argumentText })
    if (effect.type === ECommandEffect.Refused) {
      return { type: EDispatch.Refused, reason: effect.reason }
    }
    return {
      type: EDispatch.Ran,
      notice: effect.type === ECommandEffect.Ran ? effect.notice : undefined,
    }
  } catch (failure) {
    return { type: EDispatch.Refused, reason: messageOf(failure) }
  }
}
