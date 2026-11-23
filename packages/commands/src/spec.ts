import type { z } from 'zod'

export enum ECommandGroup {
  Context = 'Context',
  Session = 'Session',
  Workspace = 'Workspace',
}

export enum ECommandRunsIn {
  Client = 'client',
  Host = 'host',
  Control = 'control',
}

export enum EClientAction {
  ModelPicker = 'model-picker',
  CommandList = 'command-list',
}

export type TextArgs = { ok: true; args: unknown } | { ok: false; reason: string }

export type CommandSpec = {
  name: string
  summary: string
  group: ECommandGroup
  argumentHint?: string | undefined
  args: z.ZodType
  runsIn: ECommandRunsIn
  fromText?: ((argumentText: string) => TextArgs) | undefined
  opens?: EClientAction | undefined
}
