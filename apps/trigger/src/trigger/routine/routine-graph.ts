import { ControlPlane, type ControlStorePort, type ControlTx } from '@dltech/atlas-control'
import { PostgresControlStore } from '@dltech/atlas-control/postgres'
import { db } from '@dltech/atlas-db'

export type RoutineTxPort = Pick<ControlTx, 'readRoutine' | 'advanceRoutine' | 'insertRoutineRun'>

export type RoutineStorePort = {
  listDueRoutines: ControlStorePort['listDueRoutines']
  transact: <T>(work: (tx: RoutineTxPort) => Promise<T>) => Promise<T>
}

export type RoutinePlanePort = Pick<ControlPlane, 'runRoutine'>

export type RoutineGraph = { store: RoutineStorePort; plane: RoutinePlanePort }

export const buildRoutineGraph = (): RoutineGraph => {
  const store = new PostgresControlStore(db)

  return { store, plane: new ControlPlane({ store }) }
}
