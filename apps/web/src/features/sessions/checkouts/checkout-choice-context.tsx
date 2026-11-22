'use client'

import type { SessionStatusOutput, SessionViewOutput } from '@dltech/atlas-protocol'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import { changesSignalOf } from '../changes/changes-signal'
import { type ChangesState, useChanges } from '../changes/use-changes'
import { recallCheckout, rememberCheckout } from './checkout-memory'
import {
  type CheckoutOption,
  checkoutOptionsOf,
  currentWorktreePathOf,
  defaultCheckoutIdOf,
} from './checkout-options'

export type CheckoutChoice = {
  changes: ChangesState
  options: CheckoutOption[]
  selectedId: string | undefined
  select: (checkoutId: string) => void
}

const CheckoutChoiceContext = createContext<CheckoutChoice | null>(null)

const NO_CHECKOUTS: SessionViewOutput['checkouts'] = { repos: [], primary: null }

export function CheckoutChoiceProvider(props: {
  sessionId: string
  status: SessionStatusOutput | undefined
  view?: SessionViewOutput['checkouts'] | undefined
  currentWorktreePath?: string | undefined
  children: ReactNode
}) {
  const changes = useChanges({
    sessionId: props.sessionId,
    signal: changesSignalOf(props.status),
  })
  const view = props.view ?? NO_CHECKOUTS
  const currentWorktreePath = props.currentWorktreePath ?? currentWorktreePathOf(view)
  const options = useMemo(
    () =>
      changes.status === 'ready' ? checkoutOptionsOf({ checkouts: changes.checkouts, view }) : [],
    [changes, view],
  )
  const [chosenId, setChosenId] = useState<string | undefined>(() =>
    recallCheckout(props.sessionId),
  )
  const selectedId =
    options.find((option) => option.id === chosenId)?.id ??
    defaultCheckoutIdOf({ options, currentWorktreePath })

  const value = useMemo<CheckoutChoice>(
    () => ({
      changes,
      options,
      selectedId,
      select: (checkoutId: string) => {
        setChosenId(checkoutId)
        rememberCheckout({ sessionId: props.sessionId, checkoutId })
      },
    }),
    [changes, options, selectedId, props.sessionId],
  )

  return (
    <CheckoutChoiceContext.Provider value={value}>{props.children}</CheckoutChoiceContext.Provider>
  )
}

export function useCheckoutChoice(): CheckoutChoice {
  const value = useContext(CheckoutChoiceContext)
  if (value === null) throw new Error('useCheckoutChoice needs a CheckoutChoiceProvider')
  return value
}
