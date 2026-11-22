import type { ReactNode } from 'react'
import { BellIcon, CircleAlertIcon, CircleCheckIcon, CircleXIcon } from 'lucide-react'

import { Button } from '#components/button'
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

export interface HarnessNoticeAction {
  label: string
  onClick: () => void
}

export interface HarnessNoticeProps {
  title: string
  tone: ENoticeTone
  body?: string
  emptyNote?: string
  sections?: HarnessNoticeSection[]
  action?: HarnessNoticeAction | undefined
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

function hasText(text: string | undefined): text is string {
  return text !== undefined && text.trim().length > 0
}

function SingleSectionNotice({
  title,
  tone,
  emptyNote,
  section,
}: Omit<HarnessNoticeProps, 'sections' | 'body' | 'action'> & { section: HarnessNoticeSection }) {
  const hasContent = hasText(section.content)
  return (
    <Trace data-tone={tone}>
      <Step
        icon={ICON_OF_TONE[tone]}
        title={title}
        description={section.note ?? (hasContent ? undefined : emptyNote)}
        status={tone === ENoticeTone.Failed ? 'error' : undefined}
        contentClassName="pt-1 pl-6"
      >
        {hasContent ? <Mono>{section.content}</Mono> : undefined}
      </Step>
    </Trace>
  )
}

function NoticeAction({ action }: { action: HarnessNoticeAction }) {
  return (
    <Button variant="outline" size="xs" onClick={action.onClick} className="ml-6">
      {action.label}
    </Button>
  )
}

export function HarnessNotice({
  title,
  tone,
  body,
  emptyNote,
  sections,
  action,
}: HarnessNoticeProps) {
  const hasBody = hasText(body)
  const hasSections = sections !== undefined && sections.length > 0
  const [onlySection] = sections ?? []
  const content =
    hasBody || hasSections ? (
      <>
        {hasBody ? <Mono>{body}</Mono> : null}
        {hasSections
          ? sections.map((section) => <SectionStep key={section.id} section={section} />)
          : null}
      </>
    ) : undefined
  const notice =
    !hasBody && sections?.length === 1 && onlySection !== undefined ? (
      <SingleSectionNotice title={title} tone={tone} emptyNote={emptyNote} section={onlySection} />
    ) : (
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
  if (action === undefined) return notice
  return (
    <div className="flex flex-col items-start gap-1.5">
      {notice}
      <NoticeAction action={action} />
    </div>
  )
}
