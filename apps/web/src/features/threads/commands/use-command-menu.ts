import { useState, type KeyboardEvent } from 'react'

import { activeQuery, type CommandSpec } from '@dltech/atlas-core'

import { completedText, groupedCandidates, steppedIndex } from './menu-model'

export function useCommandMenu(args: {
  text: string
  specs: readonly CommandSpec[]
  onComplete: (text: string) => void
}) {
  const [position, setPosition] = useState({ text: args.text, index: 0 })
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  const candidates = groupedCandidates({ text: args.text, specs: args.specs })
  const open = candidates.length > 0 && dismissedFor !== args.text
  const index = position.text === args.text ? position.index : 0
  const active = Math.min(index, Math.max(candidates.length - 1, 0))

  const complete = (spec: CommandSpec) =>
    args.onComplete(completedText({ text: args.text, name: spec.name }))

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setDismissedFor(args.text)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setPosition({
        text: args.text,
        index: steppedIndex({ index: active, delta, length: candidates.length }),
      })
      return
    }
    const picked = candidates[active]
    const completes = event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)
    if (!completes || picked === undefined) return
    const typed = activeQuery(args.text)
    const exact = typed === picked.name || (picked.aliases ?? []).includes(typed ?? '')
    if (event.key === 'Enter' && exact) return
    event.preventDefault()
    complete(picked)
  }

  return { open, candidates, active, complete, handleKeyDown }
}
