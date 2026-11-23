# @dltech/atlas-jobs

The task ids, payload schemas and output schemas that the Trigger.dev worker and the API share.
The worker registers the tasks. This package only names them and validates their data.

## Owns

- The task ids: `HEARTBEAT_TASK_ID`, `ROUTINE_SWEEP_TASK_ID`, `ROUTINE_RUN_TASK_ID`,
  `POD_SLEEP_TASK_ID`, `POD_RESIZE_TASK_ID`, `NOTIFY_SEND_TASK_ID` and `NOTIFY_TEST_TASK_ID`.
- The pod payload schemas, their outcome enums and their idempotency keys.
- The payload schemas and their types for each task.
- The heartbeat output schema and type.
- The idempotency key of a routine run.

## Does not own

- The task definitions and the schedules. `apps/trigger` owns them.
- The routine logic. `@dltech/atlas-control` owns it.

## Entry points

| Import                          | Use it for                                             |
| ------------------------------- | ------------------------------------------------------ |
| `@dltech/atlas-jobs`            | Every task id, schema and key.                         |
| `@dltech/atlas-jobs/pod-sleep`  | The pod-sleep id, payload schema, outcome and key.     |
| `@dltech/atlas-jobs/pod-resize` | The pod-resize id, payload schema, outcome and key.    |
| `@dltech/atlas-jobs/notify`     | The notify-send and notify-test ids, schemas and keys. |

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

### Name a pod task

- `POD_SLEEP_TASK_ID`: `pod-sleep`, a payload of a `sessionId` and an `epoch`.
- `POD_RESIZE_TASK_ID`: `pod-resize`, a payload of a session, a generation and the pod shape.
- `POD_RESIZE_MAX_DISK_GB`: the 100 GB ceiling a resize payload enforces, the same ceiling
  `RESIZE_MAX_DISK_GB` names in `@dltech/atlas-native-commands`.

### Name a notify task

- `NOTIFY_SEND_TASK_ID`: `notify-send`, a payload of a `sessionId`, a `threadId`, a `seq` and a
  moment.
- `NOTIFY_TEST_TASK_ID`: `notify-test`, a payload of one `userId`.
- `NotifySendOutput`: the `sent` and `gone` counts of a send.
- `NO_NOTIFY_OUTPUT`: the zero counts a send answers when it sends nothing.

### Key a run once

- `routineRunIdempotencyKey(payload)`: gives `routine:<routineId>:<scheduledFor>`, so one scheduled
  run happens one time.
- `notifySendIdempotencyKey(payload)`: gives `notify:<sessionId>:<seq>`, so one moment reaches the
  devices once.
- `notifyTestIdempotencyKey({ payload, now })`: gives `notify-test:<userId>:<minute>`, so repeated
  presses inside one minute send one test.

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
