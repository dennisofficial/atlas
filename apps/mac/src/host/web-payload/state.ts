import { z } from 'zod'

const stateSchema = z.object({
  current: z.string().optional(),
  previous: z.string().optional(),
  failed: z.string().optional(),
})

export interface IPayloadState {
  current?: string
  previous?: string
  failed?: string
}

export function parseState({ input }: { input: unknown }): IPayloadState {
  const parsed = stateSchema.safeParse(input)
  if (!parsed.success) return {}
  const state: IPayloadState = {}
  if (parsed.data.current !== undefined) state.current = parsed.data.current
  if (parsed.data.previous !== undefined) state.previous = parsed.data.previous
  if (parsed.data.failed !== undefined) state.failed = parsed.data.failed
  return state
}

export function installedState({
  state,
  hash,
}: {
  state: IPayloadState
  hash: string
}): IPayloadState {
  const next: IPayloadState = { current: hash }
  if (state.current !== undefined) next.previous = state.current
  if (state.failed !== undefined && state.failed !== hash) next.failed = state.failed
  return next
}

export function failedState({
  state,
  hash,
}: {
  state: IPayloadState
  hash: string
}): IPayloadState {
  return { ...state, failed: hash }
}
