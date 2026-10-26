'use client'

import { MessageSquareReplyIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Trace } from '#components/trace'
import { EAgentDisplay } from './agent-status'
import { EStepStatus, StatusIcon, Step } from './internal/step'
import { MessageResponse } from './message-response'

export interface SubagentReportEntry {
  id: string
  agentType: string
  intent: string
  display: EAgentDisplay
  elapsed: string
  report?: string
  errorText?: string
}

export interface SubagentReportsProps {
  reports: SubagentReportEntry[]
  onOpen: (id: string) => void
}

interface ReportTitleInput {
  agentType: string
  intent: string
  failed: boolean
}

export function reportTitle({ agentType, intent, failed }: ReportTitleInput): string {
  return `${agentType} · ${intent} ${failed ? 'failed' : 'reported'}`
}

function ReportBody({ entry, failed }: { entry: SubagentReportEntry; failed: boolean }) {
  if (failed) return <p className="text-sm text-destructive">{entry.errorText}</p>
  return (
    <div className="w-full text-sm leading-relaxed">
      <MessageResponse>{entry.report ?? ''}</MessageResponse>
    </div>
  )
}

function ReportLine({
  entry,
  onOpen,
}: {
  entry: SubagentReportEntry
  onOpen: (id: string) => void
}) {
  const failed = entry.display === EAgentDisplay.Failed
  const handleOpen = () => onOpen(entry.id)
  return (
    <Step
      icon={
        <StatusIcon
          status={failed ? EStepStatus.Error : EStepStatus.Done}
          doneIcon={<MessageSquareReplyIcon />}
        />
      }
      title={reportTitle({ agentType: entry.agentType, intent: entry.intent, failed })}
      description={entry.elapsed}
      status={failed ? 'error' : undefined}
      contentClassName="flex flex-col items-start gap-3"
    >
      <ReportBody entry={entry} failed={failed} />
      <Button variant="ghost" size="xs" onClick={handleOpen}>
        Open in Agents
      </Button>
    </Step>
  )
}

export function SubagentReports({ reports, onOpen }: SubagentReportsProps) {
  return (
    <Trace>
      {reports.map((entry) => (
        <ReportLine key={entry.id} entry={entry} onOpen={onOpen} />
      ))}
    </Trace>
  )
}
