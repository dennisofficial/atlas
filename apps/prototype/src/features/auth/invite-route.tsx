'use client'

import { usePrototype } from '@/proto/use-prototype'

import { EInviteState, parseEnum, selectOf } from './auth-states'
import { InviteScreen } from './invite-screen'

const CONTROLS = {
  state: selectOf({ label: 'State', values: EInviteState, fallback: EInviteState.SignedIn }),
}

export function InviteRoute() {
  const values = usePrototype(CONTROLS)
  return (
    <InviteScreen
      state={parseEnum({
        values: EInviteState,
        raw: values.state,
        fallback: EInviteState.SignedIn,
      })}
    />
  )
}
