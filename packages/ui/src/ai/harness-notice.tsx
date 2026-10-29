import type { ReactNode } from 'react'
import { BellIcon, CircleAlertIcon, CircleCheckIcon, CircleXIcon } from 'lucide-react'

import { Trace } from '#components/trace'
import { Step } from './internal/step'

export enum ENoticeTone {
  Ok = 'ok',
  Failed = 'failed',
  Attention = 'attention',
  Quiet = 'quiet',
}

export interface HarnessNoticeSection {
  id: string
  label: string
  content: string
  note?: string
}

export interface HarnessNoticeProps {
  title: string
  tone: ENoticeTone
  body?: string
  emptyNote?: string
  sections?: HarnessNoticeSection[]
}

const ICON_OF_TONE: Record<ENoticeTone, ReactNode> = {
  [ENoticeTone.Ok]: <CircleCheckIcon />,
  [ENoticeTone.Failed]: <CircleXIcon />,
  [ENoticeTone.Attention]: <CircleAlertIcon className="text-warning" />,
  [ENoticeTone.Quiet]: <BellIcon />,
}

function Mono({ children }: { children: string }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-foreground">
      {children}
    </pre>
  )
}

function SectionStep({ section }: { section: HarnessNoticeSection }) {
  return (
    <Step
      icon={<BellIcon />}
      title={section.label}
      description={section.note}
      contentClassName="pt-1 pl-6"
    >
      {section.content.trim().length === 0 ? undefined : <Mono>{section.content}</Mono>}
    </Step>
  )
}

export function HarnessNotice({ title, tone, body, emptyNote, sections }: HarnessNoticeProps) {
  const hasBody = body !== undefined && body.trim().length > 0
  const hasSections = sections !== undefined && sections.length > 0
  const content =
    hasBody || hasSections ? (
      <>
        {hasBody ? <Mono>{body}</Mono> : null}
        {hasSections
          ? sections.map((section) => <SectionStep key={section.id} section={section} />)
          : null}
      </>
    ) : undefined
  return (
    <Trace data-tone={tone}>
      <Step
        icon={ICON_OF_TONE[tone]}
        title={title}
        description={hasBody || hasSections ? undefined : emptyNote}
        status={tone === ENoticeTone.Failed ? 'error' : undefined}
        contentClassName="pt-1 pl-6"
      >
        {content}
      </Step>
    </Trace>
  )
}
