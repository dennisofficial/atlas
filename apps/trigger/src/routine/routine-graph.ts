import type { ControlPlane, ControlStorePort, ControlTx } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'
import { composedControlPlaneOver } from '@dltech/atlas-pods'

export type RoutineTxPort = Pick<ControlTx, 'readRoutine' | 'advanceRoutine' | 'insertRoutineRun'>

export type RoutineStorePort = {
  listDueRoutines: ControlStorePort['listDueRoutines']
  transact: <T>(work: (tx: RoutineTxPort) => Promise<T>) => Promise<T>
}

export type RoutinePlanePort = Pick<ControlPlane, 'runRoutine'>

export type RoutineGraph = { store: RoutineStorePort; plane: RoutinePlanePort }

export const routineGraphOver = (store: ControlStorePort): RoutineGraph => ({
  store,
  plane: composedControlPlaneOver({ store }),
})

export const buildRoutineGraph = (): RoutineGraph => routineGraphOver(new PostgresControlStore(db))
