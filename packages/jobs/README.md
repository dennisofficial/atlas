# @dltech/atlas-jobs

The task ids, payload schemas and output schemas that the Trigger.dev worker and the API share.
The worker registers the tasks. This package only names them and validates their data.

## Owns

- The task ids: `HEARTBEAT_TASK_ID`, `ROUTINE_SWEEP_TASK_ID` and `ROUTINE_RUN_TASK_ID`.
- The payload schemas and their types for each task.
- The heartbeat output schema and type.
- The idempotency key of a routine run.

## Does not own

- The task definitions and the schedules. `apps/trigger` owns them.
- The routine logic. `@dltech/atlas-control` owns it.

## Entry points

| Import               | Use it for                                                             |
| -------------------- | ---------------------------------------------------------------------- |
| `@dltech/atlas-jobs` | The task ids, the payload and output schemas, and the idempotency key. |

## Capabilities

### Name a task

- `HEARTBEAT_TASK_ID`: the id of the heartbeat task, `heartbeat`.
- `ROUTINE_SWEEP_TASK_ID`: the id of the routine sweep task, `routine-sweep`.
- `ROUTINE_RUN_TASK_ID`: the id of the routine run task, `routine-run`.

### Validate a payload

- `heartbeatPayloadSchema` and `HeartbeatPayload`: an empty strict object.
- `routineSweepPayloadSchema` and `RoutineSweepPayload`: an empty strict object.
- `routineRunPayloadSchema` and `RoutineRunPayload`: a `routineId` and an ISO `scheduledFor`.
- `heartbeatOutputSchema` and `HeartbeatOutput`: the `taskId` and a `databaseUrlPresent` flag.

### Key a run once

- `routineRunIdempotencyKey(payload)`: gives `routine:<routineId>:<scheduledFor>`, so one scheduled
  run happens one time.

## Usage

From `apps/trigger/src/trigger/heartbeat.task.ts`:

```ts
import { HEARTBEAT_TASK_ID, type HeartbeatOutput, heartbeatOutputSchema } from '@dltech/atlas-jobs'
import { schedules } from '@trigger.dev/sdk'
import './init'

export function runHeartbeat(): HeartbeatOutput {
  const output: HeartbeatOutput = {
    taskId: HEARTBEAT_TASK_ID,
    databaseUrlPresent: Boolean(process.env['DATABASE_URL']),
  }

  console.log(JSON.stringify(output))

  return heartbeatOutputSchema.parse(output)
}

export const heartbeatTask = schedules.task({
  id: HEARTBEAT_TASK_ID,
  cron: '*/15 * * * *',
  run: async () => runHeartbeat(),
})
```

## Rules

- Keep the schemas strict. An unknown payload key is a failure, not a silent drop.
- Use `routineRunIdempotencyKey` as the idempotency key of a routine run. Do not build the key at
  the caller.

## See also

- `apps/trigger/src/trigger/routine/routine-run.task.ts` uses the routine payload and the key.
