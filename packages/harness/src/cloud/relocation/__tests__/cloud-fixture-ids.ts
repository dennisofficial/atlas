import { toThreadId } from '@dltech/atlas-core'

import type { LiftedWorkspace } from '../cloud-bridge'
import { SPEC_SHARD } from './fake-backend'

export const CLOUD_THREAD = toThreadId(`cloud-thread-${SPEC_SHARD}`)

export const CLEAN_WORKSPACE: LiftedWorkspace = {
  remoteUrl: 'git@github.com:comp-ai/atlas.git',
  branch: 'dennis/container-cloud',
  commit: 'abc1234',
  patch: '',
}
