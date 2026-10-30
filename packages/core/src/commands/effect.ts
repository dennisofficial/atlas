export enum ECommandTiming {
  Immediate = 'immediate',
  Settled = 'settled',
}

export enum ECommandEcho {
  Silent = 'silent',
  Name = 'name',
  Output = 'output',
}

export enum ECommandEffect {
  Ran = 'ran',
  Refused = 'refused',
  Nothing = 'nothing',
}

export type CommandEffect =
  | { type: ECommandEffect.Ran; notice?: string | undefined }
  | { type: ECommandEffect.Refused; reason: string }
  | { type: ECommandEffect.Nothing }

export const RAN: CommandEffect = { type: ECommandEffect.Ran }
export const NOTHING: CommandEffect = { type: ECommandEffect.Nothing }

export const refused = (reason: string): CommandEffect => ({
  type: ECommandEffect.Refused,
  reason,
})
