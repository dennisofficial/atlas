import { DAEMON_PORT, DAEMON_PORT_ENV } from '@dltech/atlas-protocol'

import { SANDBOX_HOME_PATH } from '../constants'

import {
  AGENT37_POD_SESSION_KEY,
  agent37InstanceNameOf,
  type Agent37Env,
} from './agent37-instances'
import type { Agent37CreateArgs } from './agent37-client'
import { agent37ShapeOfVcpus } from './agent37-resize'

export const AGENT37_IDLE_TIMEOUT_SECONDS = 1800
export const AGENT37_MOUNT_PATH = SANDBOX_HOME_PATH.replace(/\/home$/, '')

export const agent37CreateBodyOf = (args: {
  env: Agent37Env
  podSessionId: string
  sandboxName: string
  token: string
  bundleUrl: string
  vcpus?: number | undefined
  diskGb?: number | undefined
}): Agent37CreateArgs => ({
  template: args.env.template,
  type: 'vm',
  region: 'us',
  name: agent37InstanceNameOf(args.podSessionId),
  metadata: { [AGENT37_POD_SESSION_KEY]: args.podSessionId },
  resources: {
    ...(args.vcpus === undefined ? args.env.resources : agent37ShapeOfVcpus(args.vcpus)),
    disk: args.diskGb ?? args.env.resources.disk,
  },
  mount_path: AGENT37_MOUNT_PATH,
  auto_sleep: true,
  idle_timeout_seconds: AGENT37_IDLE_TIMEOUT_SECONDS,
  env: {
    DAEMON_TOKEN: args.token,
    ATLAS_DAEMON_BUNDLE_URL: args.bundleUrl,
    ATLAS_SANDBOX_NAME: args.sandboxName,
    [DAEMON_PORT_ENV]: String(DAEMON_PORT),
  },
})
