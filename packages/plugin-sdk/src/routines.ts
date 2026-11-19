import type {
  Routine,
  RoutineCreateInput,
  RoutineRemoveOutput,
  RoutineRunOutput,
  RoutineUpdateInput,
} from '@dltech/atlas-protocol'

export type PodRoutineInput = Omit<RoutineCreateInput, 'projectId'>

export type PodRoutines = {
  list(): Promise<readonly Routine[]>
  get(args: { routineId: string }): Promise<Routine>
  create(input: PodRoutineInput): Promise<Routine>
  update(input: RoutineUpdateInput): Promise<Routine>
  remove(args: { routineId: string }): Promise<RoutineRemoveOutput>
  run(args: { routineId: string }): Promise<RoutineRunOutput>
}

const noRoutines = (): never => {
  throw new Error('this session cannot reach the routines of a project')
}

export const EMPTY_ROUTINES: PodRoutines = Object.freeze({
  list: async () => noRoutines(),
  get: async () => noRoutines(),
  create: async () => noRoutines(),
  update: async () => noRoutines(),
  remove: async () => noRoutines(),
  run: async () => noRoutines(),
})
