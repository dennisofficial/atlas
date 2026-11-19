import { SANDBOX_HOME_PATH, SANDBOX_SERVE_PORT } from '../constants'

import {
  AGENT37_POD_SESSION_KEY,
  agent37InstanceNameOf,
  type Agent37Env,
} from './agent37-instances'
import type { Agent37CreateArgs } from './agent37-client'

export const AGENT37_IDLE_TIMEOUT_SECONDS = 1800
export const AGENT37_MOUNT_PATH = SANDBOX_HOME_PATH.replace(/\/home$/, '')

export const agent37CreateBodyOf = (args: {
  env: Agent37Env
  podSessionId: string
  sandboxName: string
  token: string
}): Agent37CreateArgs => ({
  template: args.env.template,
  type: 'vm',
  region: 'us',
  name: agent37InstanceNameOf(args.podSessionId),
  metadata: { [AGENT37_POD_SESSION_KEY]: args.podSessionId },
  resources: args.env.resources,
  mount_path: AGENT37_MOUNT_PATH,
  auto_sleep: true,
  idle_timeout_seconds: AGENT37_IDLE_TIMEOUT_SECONDS,
  env: {
    DAEMON_TOKEN: args.token,
    ATLAS_SANDBOX_NAME: args.sandboxName,
    PORT: String(SANDBOX_SERVE_PORT),
  },
})
