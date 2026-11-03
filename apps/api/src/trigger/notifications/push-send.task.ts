import { schemaTask, wait } from '@trigger.dev/sdk'
import {
  PUSH_SEND_TASK_ID,
  pushSendPayloadSchema,
  type PushSendOutput,
  type PushSendPayload,
  type PushSendTask,
} from '../../api/platform/notifications/push-send.contract'
import { runPushSend } from '../../api/platform/notifications/push-send-run'
import { buildPushSendDeps } from './push-send-graph'

export async function runPushSendTask(payload: PushSendPayload): Promise<PushSendOutput> {
  return runPushSend({
    payload,
    deps: buildPushSendDeps({ wait: (ms) => wait.for({ seconds: ms / 1000 }) }),
  })
}

export const pushSendTask = schemaTask({
  id: PUSH_SEND_TASK_ID,
  schema: pushSendPayloadSchema,
  retry: { maxAttempts: 3 },
  run: runPushSendTask,
}) satisfies PushSendTask
