import { db } from '@dltech/atlas-db'
import { createExpoPushClient } from '../../_lib/expo-push/expo-push.client'
import type { PushSendDeps } from '../../api/platform/notifications/push-send-run'
import { workerEnvService } from '../github/github-sweep-graph'

export function buildPushSendDeps(args: { wait: (ms: number) => Promise<void> }): PushSendDeps {
  const env = workerEnvService()
  const client = createExpoPushClient({ accessToken: env.get('EXPO_ACCESS_TOKEN') })
  return {
    send: (messages) => client.send(messages),
    getReceipts: (ticketIds) => client.getReceipts(ticketIds),
    wait: args.wait,
    pruneTokens: async (tokens) => {
      await db.orm.public.PushDevice.where((device) => device.token.in(tokens)).deleteAndCount()
    },
    log: (message) => console.warn(message),
  }
}
