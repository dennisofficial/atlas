import { useState, type KeyboardEvent, type ReactNode } from 'react'

import { Context } from '@dltech/atlas-ui/ai/context'
import { EEffort, ModelSelector } from '@dltech/atlas-ui/ai/model-selector'
import type { PlanStep } from '@dltech/atlas-ui/ai/plan'
import { PromptInput } from '@dltech/atlas-ui/ai/prompt-input'
import {
  QueuedMessages,
  type QueuedMessageEntry,
  type QueuedMessageSave,
} from '@dltech/atlas-ui/ai/queued-messages'
import { TaskDock } from '@dltech/atlas-ui/ai/task-dock'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { MODELS } from '@dltech/atlas-ui/fixtures/agent'

export interface ComposerProps {
  steps?: PlanStep[]
  queued?: QueuedMessageEntry[]
  busy?: boolean
  onSaveQueued?: (save: QueuedMessageSave) => void
  onRemoveQueued?: (id: string) => void
  onSend: (text: string) => void
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  showContext?: boolean
  onEscape?: () => void
  hint?: ReactNode
  className?: string
  children?: ReactNode
}

const noop = () => undefined

const CONTEXT_BREAKDOWN = [
  { label: 'System prompt', tokens: 6_200 },
  { label: 'Tools', tokens: 14_800 },
  { label: 'Messages', tokens: 31_400 },
]

export function Composer({
  steps = [],
  queued = [],
  busy = false,
  onSaveQueued = noop,
  onRemoveQueued = noop,
  onSend,
  value,
  onValueChange,
  placeholder,
  disabled = false,
  showContext = true,
  onEscape,
  hint,
  className,
  children,
}: ComposerProps) {
  const [model, setModel] = useState('claude-opus')
  const [effort, setEffort] = useState(EEffort.High)
  const [internalDraft, setInternalDraft] = useState('')
  const draft = value ?? internalDraft

  const handleDraftChange = (next: string) => {
    setInternalDraft(next)
    onValueChange?.(next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !onEscape) return
    if (!(event.target instanceof HTMLTextAreaElement)) return
    event.preventDefault()
    onEscape()
  }

  const handleSubmit = (text: string) => {
    onSend(text)
    setInternalDraft('')
  }

  return (
    <div
      onKeyDown={handleKeyDown}
      className={cn('mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-2 px-4 pb-4', className)}
    >
      <TaskDock steps={steps} queued={[]} />
      <QueuedMessages messages={queued} onSave={onSaveQueued} onRemove={onRemoveQueued} />
      <fieldset disabled={disabled} className="m-0 min-w-0 border-0 p-0">
        <PromptInput
          value={draft}
          onValueChange={handleDraftChange}
          onSubmit={handleSubmit}
          busy={busy}
          queueWhileBusy
          placeholder={
            placeholder ?? (busy ? 'Queue a message for when Atlas is done…' : undefined)
          }
        >
          <ModelSelector
            models={MODELS}
            value={model}
            onValueChange={setModel}
            effort={effort}
            onEffortChange={setEffort}
          />
          {children}
          {showContext ? (
            <Context
              className="ml-auto"
              used={52_400}
              limit={200_000}
              breakdown={CONTEXT_BREAKDOWN}
            />
          ) : null}
        </PromptInput>
      </fieldset>
      {hint}
    </div>
  )
}
