'use client'

import { usePrototype } from '@/proto/use-prototype'

import { EResetState, parseEnum, selectOf } from './auth-states'
import { ResetScreen } from './reset-screen'

const CONTROLS = {
  state: selectOf({ label: 'State', values: EResetState, fallback: EResetState.Idle }),
}

export function ResetPasswordRoute() {
  const values = usePrototype(CONTROLS)
  return (
    <ResetScreen
      state={parseEnum({ values: EResetState, raw: values.state, fallback: EResetState.Idle })}
    />
  )
}
