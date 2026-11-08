import {
  EShellStatus,
  shellLabel,
  type Event,
  type PluginViewFold,
  type V2Event,
} from '@dltech/atlas-core'
import { z } from 'zod'

export const SHELLS_VIEW = 'shells'

export const shellRowSchema = z.object({
  shellId: z.string().min(1),
  name: z.string(),
  command: z.string(),
  cwd: z.string().optional(),
  status: z.enum(EShellStatus),
  characters: z.number().int().nonnegative(),
  awaitingInput: z.boolean(),
  changedAt: z.string(),
})

export const shellsViewSchema = z.array(shellRowSchema).readonly()

export type ShellRow = z.infer<typeof shellRowSchema>
export type ShellsViewState = readonly ShellRow[]

type Carried = Pick<ShellRow, 'shellId' | 'name' | 'command' | 'characters'> &
  Partial<Pick<ShellRow, 'cwd'>>

const upsert = (state: ShellsViewState, row: ShellRow): ShellsViewState =>
  state.some((kept) => kept.shellId === row.shellId)
    ? state.map((kept) => (kept.shellId === row.shellId ? row : kept))
    : [...state, row]

const carriedOf = (args: {
  state: ShellsViewState
  event: { shellId: string; command: string; description?: string | undefined }
}): Carried => {
  const existing = args.state.find((kept) => kept.shellId === args.event.shellId)
  if (existing !== undefined) return existing
  return {
    shellId: args.event.shellId,
    name: shellLabel(args.event),
    command: args.event.command,
    characters: 0,
  }
}

export const foldShells = (state: ShellsViewState, event: Event | V2Event): ShellsViewState => {
  if (event.type === 'background-shell-started') {
    return upsert(state, {
      shellId: event.shellId,
      name: shellLabel(event),
      command: event.command,
      ...(event.cwd === undefined ? {} : { cwd: event.cwd }),
      status: EShellStatus.Running,
      characters: 0,
      awaitingInput: false,
      changedAt: event.at,
    })
  }
  if (event.type === 'background-shell-ended') {
    const base = carriedOf({ state, event })
    return upsert(state, {
      ...base,
      status: event.status,
      characters: base.characters + event.output.length,
      awaitingInput: false,
      changedAt: event.at,
    })
  }
  if (event.type === 'background-shell-awaiting-input') {
    const base = carriedOf({ state, event })
    return upsert(state, {
      ...base,
      status: EShellStatus.Running,
      characters: base.characters + event.output.length,
      awaitingInput: true,
      changedAt: event.at,
    })
  }
  return state
}

export const shellsView: PluginViewFold<ShellsViewState> = {
  name: SHELLS_VIEW,
  initial: [],
  fold: foldShells,
}

export const shellsOfEvents = (events: readonly (Event | V2Event)[]): ShellsViewState =>
  events.reduce(foldShells, shellsView.initial)
