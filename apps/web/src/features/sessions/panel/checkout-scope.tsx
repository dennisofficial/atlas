'use client'

import type { ReactNode } from 'react'

import { CheckoutChoiceProvider } from '../checkouts/checkout-choice-context'
import { currentWorktreePathOf } from '../checkouts/checkout-options'
import { useSessionPaneValue } from './pane-value'

export function SessionCheckoutScope({ children }: { children: ReactNode }) {
  const { sessionId, status, checkouts, threadWorktreePath } = useSessionPaneValue()
  return (
    <CheckoutChoiceProvider
      sessionId={sessionId}
      status={status}
      view={checkouts}
      currentWorktreePath={threadWorktreePath ?? currentWorktreePathOf(checkouts)}
    >
      {children}
    </CheckoutChoiceProvider>
  )
}
