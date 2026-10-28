import { afterEach, describe, expect, it } from 'bun:test'

import { ENoticeStage, EShellStatus } from '@dltech/atlas-core'

import { bootId } from '../boot'
import { closeRegistries, openRegistry, THREAD } from './shell-registry-fixture'
import { RecordingLog } from './shell-registry-log'

afterEach(closeRegistries)

const arrival = (id: string) =>
  ({
    type: 'background-shell-ended',
    shellId: 'bash_1',
    command: 'bun test',
    description: 'tests',
    bootId,
    status: EShellStatus.Exited,
    exitCode: 0,
    output: 'ok',
    droppedCharacters: 0,
    remainingCharacters: 0,
    notice: { id, stage: ENoticeStage.Arrived },
  }) as const

describe('a shell ending that arrived before a restart', () => {
  it('is delivered once from the log by a fresh registry', async () => {
    const log = new RecordingLog()
    await log.append({ threadId: THREAD, drafts: [arrival('n1')] })
    const { registry } = openRegistry({ log })

    await registry.reconcile({ threadId: THREAD })
    await registry.reconcile({ threadId: THREAD })

    expect(registry.pendingNotices({ threadId: THREAD })).toHaveLength(1)
    const batch = registry.prepareNotifications({ threadId: THREAD })
    expect(batch.wakesTurn).toBe(true)
    expect(batch.drafts).toEqual([
      expect.objectContaining({
        type: 'background-shell-ended',
        notice: { id: 'n1', stage: ENoticeStage.Delivered },
      }),
    ])
    batch.acknowledge()
    expect(registry.prepareNotifications({ threadId: THREAD }).drafts).toEqual([])
  })

  it('is not queued once its delivered row is in the log', async () => {
    const log = new RecordingLog()
    const arrived = arrival('n2')
    await log.append({
      threadId: THREAD,
      drafts: [arrived, { ...arrived, notice: { id: 'n2', stage: ENoticeStage.Delivered } }],
    })
    const { registry } = openRegistry({ log })

    await registry.reconcile({ threadId: THREAD })

    expect(registry.pendingNotices({ threadId: THREAD })).toEqual([])
  })
})
