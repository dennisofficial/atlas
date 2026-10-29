'use client'

import type { ReactNode } from 'react'
import { BotIcon, ListChecksIcon, WrenchIcon } from 'lucide-react'

import { EToolKind, EToolState, Tool, ToolLine } from '@dltech/atlas-ui/ai/tool'
import { Trace } from '@dltech/atlas-ui/components/trace'

import { EToolFamily, type ToolCallItem } from '../data/transcript-items'

const ICON_OF_FAMILY: Record<EToolFamily, ReactNode> = {
  [EToolFamily.Agent]: <BotIcon />,
  [EToolFamily.Plan]: <ListChecksIcon />,
  [EToolFamily.Other]: <WrenchIcon />,
}

const OPENABLE_STATES: readonly EToolState[] = [EToolState.Running, EToolState.Done]

const isOpenableEdit = (call: ToolCallItem): call is ToolCallItem & { path: string } =>
  call.kind === EToolKind.Edit && call.path !== undefined && OPENABLE_STATES.includes(call.state)

function EditToolRow({
  call,
  onOpenChanges,
}: {
  call: ToolCallItem & { path: string }
  onOpenChanges: (path: string) => void
}) {
  const handleOpen = () => onOpenChanges(call.path)
  return (
    <Trace>
      <button
        type="button"
        aria-label={`Open ${call.label} in Changes`}
        onClick={handleOpen}
        className="w-fit max-w-full rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ToolLine kind={call.kind} state={call.state} label={call.label} elapsed={call.elapsed} />
      </button>
    </Trace>
  )
}

export function ToolRow({
  call,
  onOpenChanges,
}: {
  call: ToolCallItem
  onOpenChanges: ((path: string) => void) | null
}) {
  if (onOpenChanges !== null && isOpenableEdit(call)) {
    return <EditToolRow call={call} onOpenChanges={onOpenChanges} />
  }
  return (
    <Tool
      kind={call.kind}
      state={call.state}
      label={call.label}
      title={call.title}
      icon={call.family === undefined ? undefined : ICON_OF_FAMILY[call.family]}
      output={call.output}
      errorText={call.errorText}
      elapsed={call.elapsed}
    />
  )
}
