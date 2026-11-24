'use client'

import type { ReactNode } from 'react'

import { elapsedClockOf, type BlockingCommand } from '@dltech/atlas-client/stream'
import { ECommandState, type SessionCommandRow } from '@dltech/atlas-protocol'

import { useNow } from '@/features/threads/data/use-now'

import { CommandRows } from '../command-rows'
import { BlockingStrip } from './blocking-strip'

const otherRowsOf = (args: {
  rows: readonly SessionCommandRow[] | undefined
  blocking: BlockingCommand | undefined
}): readonly SessionCommandRow[] | undefined => {
  const { rows, blocking } = args
  if (rows === undefined || blocking === undefined) return rows
  return rows.filter(
    (row) => !(row.state === ECommandState.Running && row.inboxId === blocking.inboxId),
  )
}

export function BlockingDock({
  blocking,
  commands,
  children,
}: {
  blocking: BlockingCommand | undefined
  commands: readonly SessionCommandRow[] | undefined
  children: ReactNode
}) {
  const now = useNow(blocking !== undefined)
  return (
    <>
      <CommandRows rows={otherRowsOf({ rows: commands, blocking })} />
      <div data-blocking-join={blocking === undefined ? undefined : ''}>
        {blocking === undefined ? null : (
          <BlockingStrip
            copy={blocking.copy}
            elapsed={elapsedClockOf({ startedAt: blocking.startedAt, now })}
          />
        )}
        {children}
      </div>
    </>
  )
}
