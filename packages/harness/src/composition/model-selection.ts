import { refKey, type EEffort, type ModelRef } from '@dltech/atlas-core'
import { createSwitchableModel, type Switchable } from '../model/switchable-model'

import { isRefReachable, unanswerableRef, type ModelCatalogue } from './model-catalogue'

export type ModelSelection = { ref: ModelRef; effort: EEffort; fast?: boolean | undefined }

/** What the app is allowed to know: which pair is answering, and how to change it. */
export type ModelChoice = {
  choice: () => ModelSelection
  select: (next: ModelSelection) => void
  /** Fires when a provider refused fast mode and the selection fell back to standard speed. */
  onFastRefused: (listener: (selection: ModelSelection) => void) => () => void
}

export type SelectableModel = Switchable<ModelSelection> & Pick<ModelChoice, 'onFastRefused'>

const unbuildable = (ref: ModelRef): Error => unanswerableRef(refKey(ref))

export function selectableModel(args: {
  initial: ModelSelection
  catalogue: ModelCatalogue
}): SelectableModel {
  let held = args.initial
  const refusedListeners = new Set<(selection: ModelSelection) => void>()

  const handleFastRefused = () => {
    if (held.fast !== true) return
    held = { ...held, fast: false }
    switchable.select(held)
    for (const listener of [...refusedListeners]) listener(held)
  }

  const switchable = createSwitchableModel<ModelSelection>({
    initial: args.initial,
    keyOf: (choice) => refKey(choice.ref),
    build: (choice) => {
      const card = args.catalogue.cardFor(choice.ref)
      const adapter = args.catalogue.adapterFor(choice.ref.providerId)
      if (card === undefined || adapter === undefined) throw unbuildable(choice.ref)

      return adapter.model({
        card,
        effort: () => held.effort,
        fast: () => held.fast === true,
        onFastRefused: handleFastRefused,
      })
    },
  })

  return {
    ...switchable,
    select: (next) => {
      if (!isRefReachable({ catalogue: args.catalogue, ref: next.ref })) return

      held = next
      switchable.select(next)
    },
    onFastRefused: (listener) => {
      refusedListeners.add(listener)
      return () => {
        refusedListeners.delete(listener)
      }
    },
  }
}

export function heldChoice(initial: ModelSelection): ModelChoice {
  let held = initial
  return {
    choice: () => held,
    select: (next) => {
      held = next
    },
    onFastRefused: () => () => undefined,
  }
}
