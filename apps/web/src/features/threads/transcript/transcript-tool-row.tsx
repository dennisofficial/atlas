'use client'

import type { ReactNode } from 'react'
import { BotIcon, ListChecksIcon, WrenchIcon } from 'lucide-react'

import { EToolKind, EToolState, Tool, ToolLine } from '@dltech/atlas-ui/ai/tool'
import { DiffViewer } from '@dltech/atlas-ui/ai/diff-viewer'
import { CodeBlock, CodeBlockContent } from '@dltech/atlas-ui/components/code-block'
import { Trace } from '@dltech/atlas-ui/components/trace'

import { EEditBody, EToolFamily, type EditBody, type ToolCallItem } from '../data/transcript-items'

const ICON_OF_FAMILY: Record<EToolFamily, ReactNode> = {
  [EToolFamily.Agent]: <BotIcon />,
  [EToolFamily.Plan]: <ListChecksIcon />,
  [EToolFamily.Other]: <WrenchIcon />,
}

const OPENABLE_STATES: readonly EToolState[] = [EToolState.Running, EToolState.Done]

const isOpenableEdit = (call: ToolCallItem): call is ToolCallItem & { path: string } =>
  call.kind === EToolKind.Edit && call.path !== undefined && OPENABLE_STATES.includes(call.state)

function EditBodyView({ body, label }: { body: EditBody; label: string }) {
  if (body.kind === EEditBody.Diff) {
    return <DiffViewer path={label} lines={body.lines} added={body.added} removed={body.removed} />
  }
  return (
    <CodeBlock size="sm">
      <CodeBlockContent lineNumbers startLine={body.firstLine} className="max-h-64">
        {body.text}
      </CodeBlockContent>
    </CodeBlock>
  )
}

function EditLine({
  call,
  onOpenChanges,
}: {
  call: ToolCallItem & { path: string }
  onOpenChanges: ((path: string) => void) | null
}) {
  const line = (
    <ToolLine kind={call.kind} state={call.state} label={call.label} elapsed={call.elapsed} />
  )
  if (onOpenChanges === null) return line
  const handleOpen = () => onOpenChanges(call.path)
  return (
    <button
      type="button"
      aria-label={`Open ${call.label} in Changes`}
      onClick={handleOpen}
      className="w-fit max-w-full rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {line}
    </button>
  )
}

function EditToolRow({
  call,
  onOpenChanges,
}: {
  call: ToolCallItem & { path: string }
  onOpenChanges: ((path: string) => void) | null
}) {
  return (
    <Trace>
      <EditLine call={call} onOpenChanges={onOpenChanges} />
      {call.change === undefined ? null : <EditBodyView body={call.change} label={call.label} />}
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
  if (isOpenableEdit(call) && (onOpenChanges !== null || call.change !== undefined)) {
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
