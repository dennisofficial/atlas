import type { RecordEvent } from '../event'

export type PluginViewFold<TState = unknown> = {
  name: string
  initial: TState
  fold(state: TState, event: RecordEvent): TState
  rewindable?: boolean
}
