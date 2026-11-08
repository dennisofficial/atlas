import type { V2Event } from '../event'

export type PluginViewFold<TState = unknown> = {
  name: string
  initial: TState
  fold(state: TState, event: V2Event): TState
}
