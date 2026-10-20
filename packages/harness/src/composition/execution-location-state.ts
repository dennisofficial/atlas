import { type EExecutionLocation } from '@dltech/atlas-core'

import type { InjectionToken } from '../container/injection'
import { PlacementController } from './placement-controller'

export type ExecutionLocationState = PlacementController

export function createExecutionLocationState(args: {
  initial: EExecutionLocation
}): PlacementController {
  return new PlacementController(args.initial)
}

export type ExecutionLocationControl = {
  state: PlacementController
  pinned: boolean
}

export const ExecutionLocationToken: InjectionToken<ExecutionLocationControl> = Symbol(
  'atlas.ExecutionLocation',
)
