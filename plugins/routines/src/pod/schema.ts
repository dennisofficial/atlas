import { z } from 'zod'

export enum ERoutineAction {
  List = 'list',
  Get = 'get',
  Create = 'create',
  Update = 'update',
  Delete = 'delete',
  Run = 'run',
}

const routineInputBase = z.strictObject({
  action: z.enum(ERoutineAction),
  routineId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  prompt: z.string().min(1).max(20_000).optional(),
  cron: z.string().min(1).max(120).optional(),
  timezone: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  model: z.string().min(1).nullable().optional(),
  effort: z.string().min(1).nullable().optional(),
  fast: z.boolean().nullable().optional(),
})

export type RoutineInput = z.output<typeof routineInputBase>

const REQUIRED: Record<ERoutineAction, readonly (keyof RoutineInput)[]> = {
  [ERoutineAction.List]: [],
  [ERoutineAction.Get]: ['routineId'],
  [ERoutineAction.Create]: ['name', 'prompt', 'cron', 'timezone'],
  [ERoutineAction.Update]: ['routineId'],
  [ERoutineAction.Delete]: ['routineId'],
  [ERoutineAction.Run]: ['routineId'],
}

const CHANGED: readonly (keyof RoutineInput)[] = [
  'name',
  'prompt',
  'cron',
  'timezone',
  'enabled',
  'model',
  'effort',
  'fast',
]

const SETTINGS = ['model', 'effort', 'fast'] as const

export const routineInputSchema = routineInputBase.superRefine((input, ctx) => {
  for (const field of REQUIRED[input.action]) {
    if (input[field] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `action "${input.action}" needs ${field}`,
      })
    }
  }
  if (
    input.action === ERoutineAction.Update &&
    CHANGED.every((field) => input[field] === undefined)
  ) {
    ctx.addIssue({
      code: 'custom',
      message: `action "update" changes nothing: pass at least one of ${CHANGED.join(', ')} beside routineId`,
    })
  }
  if (input.action === ERoutineAction.Create) {
    for (const field of SETTINGS) {
      if (input[field] === null) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `action "create" takes ${field} as a value, not null: omit it to follow the project default`,
        })
      }
    }
  }
})
