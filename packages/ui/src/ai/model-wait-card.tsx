import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDownIcon, HourglassIcon, LoaderCircleIcon } from 'lucide-react'

import { Button } from '#components/button'
import { Collapsible, CollapsibleContent } from '#components/collapsible'

export enum EModelWaitNoteTone {
  Done = 'done',
  Info = 'info',
  Retry = 'retry',
  Error = 'error',
}

export interface ModelWaitConfirm {
  title: string
  description: string
  confirmLabel: string
}

export interface ModelWaitAction {
  id: string
  label: string
  primary: boolean
  disabled: boolean
  disabledReason?: string
  pending?: boolean
  pendingLabel?: string
  confirm?: ModelWaitConfirm
  onSelect: () => void
}

export interface ModelWaitAffected {
  id: string
  label: string
  onOpen?: () => void
}

export interface ModelWaitNote {
  tone: EModelWaitNoteTone
  text: string
}

export interface ModelWaitIssueView {
  id: string
  detail: string
  meta: string
  affectedLabel: string
  affected: ModelWaitAffected[]
  actions: ModelWaitAction[]
  note?: ModelWaitNote
}

export interface ModelWaitCardProps {
  title: string
  issues: ModelWaitIssueView[]
  announcement: string
  partialNote?: string
}

function ActionButton({ action }: { action: ModelWaitAction }) {
  const [confirming, setConfirming] = useState(false)
  const pending = action.pending === true
  const handleClick = () => {
    if (action.confirm === undefined) action.onSelect()
    else setConfirming(true)
  }
  const handleConfirm = () => {
    setConfirming(false)
    action.onSelect()
  }
  if (confirming && action.confirm !== undefined) {
    return (
      <fieldset aria-label={action.confirm.title} className="flex w-full min-w-0 flex-col gap-2">
        <p className="text-xs wrap-anywhere text-muted-foreground">{action.confirm.description}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button size="sm" autoFocus onClick={handleConfirm}>
            {action.confirm.confirmLabel}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </fieldset>
    )
  }
  return (
    <Button
      size="sm"
      variant={action.primary ? 'default' : 'outline'}
      disabled={action.disabled || pending}
      title={action.disabled && !pending ? action.disabledReason : undefined}
      onClick={handleClick}
    >
      {pending ? <LoaderCircleIcon className="animate-spin" data-icon="inline-start" /> : null}
      {pending ? (action.pendingLabel ?? action.label) : action.label}
    </Button>
  )
}

function Affected({ items, empty }: { items: ModelWaitAffected[]; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>
  return (
    <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs">
      {items.map((item) => (
        <li key={item.id} className="min-w-0 wrap-anywhere">
          {item.onOpen === undefined ? (
            <span className="text-muted-foreground">{item.label}</span>
          ) : (
            <Button variant="link" size="xs" onClick={item.onOpen}>
              {item.label}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

function IssueNote({ note }: { note: ModelWaitNote }) {
  const failed = note.tone === EModelWaitNoteTone.Error
  return (
    <p
      role={failed ? 'alert' : undefined}
      className={failed ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
    >
      {note.text}
    </p>
  )
}

function Issue({ issue, open }: { issue: ModelWaitIssueView; open: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm wrap-anywhere text-foreground">{issue.detail}</p>
      <Collapsible open={open}>
        <CollapsibleContent>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">{issue.meta}</p>
            <p className="text-xs font-medium text-muted-foreground">{issue.affectedLabel}</p>
            <Affected items={issue.affected} empty="No sessions currently waiting" />
          </div>
        </CollapsibleContent>
      </Collapsible>
      {issue.note === undefined ? null : <IssueNote note={issue.note} />}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {issue.actions.map((action) => (
          <ActionButton key={action.id} action={action} />
        ))}
      </div>
    </div>
  )
}

export function ModelWaitCard({ title, issues, announcement, partialNote }: ModelWaitCardProps) {
  const [open, setOpen] = useState(true)
  const headingId = useId()
  const toggle = useRef<HTMLButtonElement>(null)
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
    toggle.current?.focus()
  }
  return (
    <section
      aria-labelledby={headingId}
      data-slot="model-wait-card"
      onKeyDown={handleKeyDown}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 px-3 py-3"
    >
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="flex items-center gap-2">
        <HourglassIcon className="size-4 shrink-0 text-warning" aria-hidden />
        <h3 id={headingId} className="min-w-0 flex-1 text-sm font-medium">
          {title}
        </h3>
        <Button
          ref={toggle}
          variant="ghost"
          size="xs"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? 'Hide details' : 'Show details'}
          <ChevronDownIcon data-icon="inline-end" className={open ? 'rotate-180' : undefined} />
        </Button>
      </div>
      {issues.map((issue) => (
        <Issue key={issue.id} issue={issue} open={open} />
      ))}
      {partialNote === undefined ? null : (
        <p className="text-xs text-muted-foreground">{partialNote}</p>
      )}
    </section>
  )
}
