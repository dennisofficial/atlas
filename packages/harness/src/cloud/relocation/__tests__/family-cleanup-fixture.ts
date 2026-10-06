import { createHash } from 'node:crypto'

import type { ThreadId } from '@dltech/atlas-core'
import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'

import { EClientRequest } from '../../channel-wire'
import type { RestoredWorkspace } from '../../../workspace/transfer/manifest'
import { CLOUD_THREAD, fakeBridge, type FakeBridge, type FakeCloudChannel } from './fixture'
import { DUMMY_ARCHIVE, PREPARE_REPLY, RESTORED_HOME } from './workspace-fixture'

export const SOURCE_SESSION = 'session-source'
export const GENERATION = 'generation-1'
export const ARCHIVE_SHA256 = createHash('sha256').update(DUMMY_ARCHIVE).digest('hex')

export const FAMILY_RESTORED: RestoredWorkspace = {
  ...RESTORED_HOME,
  family: {
    rootId: CLOUD_THREAD,
    checkouts: [],
    threads: [{ threadId: CLOUD_THREAD, home: '/work', active: null }],
  },
}

export type Candidate = { safe: boolean; reasons: string[] }

export type ConfirmAnswer = { safe: boolean; reasons: string[]; sourceSessionId: string } | Error

export type DestroyCall = { threadId: ThreadId; expectedSandboxSessionId?: string | undefined }

export type FamilyCleanupSetup = {
  bridge: FakeBridge
  channel: FakeCloudChannel
  destroyCalls: DestroyCall[]
  confirmations: unknown[]
}

export function familyCleanupSetup(args: {
  archive: SessionArchiveDescriptor | null
  candidate?: Candidate | undefined
  sha256?: string | undefined
  confirm?: ConfirmAnswer | undefined
  destroyFails?: unknown
}): FamilyCleanupSetup {
  const bridge = fakeBridge({ archive: args.archive })
  const channel = bridge.attach({ threadId: CLOUD_THREAD, url: '', token: '' }).channel
  const destroyCalls: DestroyCall[] = []
  const confirmations: unknown[] = []
  const destroy = bridge.sandboxes.destroy.bind(bridge.sandboxes)
  bridge.sandboxes.destroy = async (given) => {
    destroyCalls.push(given)
    if (args.destroyFails !== undefined) throw args.destroyFails
    return destroy(given)
  }
  const served = channel.request.bind(channel)
  channel.request = async (given) => {
    if (given.op === EClientRequest.PrepareWorkspaceArchive) {
      return {
        ...PREPARE_REPLY,
        sha256: args.sha256 ?? ARCHIVE_SHA256,
        ...(args.candidate === undefined
          ? {}
          : { cleanup: { generation: GENERATION, sourceSessionId: SOURCE_SESSION, ...args.candidate } }),
      }
    }
    if (given.op === EClientRequest.ConfirmWorkspaceCleanup) {
      confirmations.push(given.params)
      if (args.confirm instanceof Error) throw args.confirm
      return args.confirm ?? { safe: true, reasons: [], sourceSessionId: SOURCE_SESSION }
    }
    return served(given)
  }
  return { bridge, channel, destroyCalls, confirmations }
}
