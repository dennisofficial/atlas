'use client'

import { usePrototype } from '@/proto/use-prototype'

import { EForgotState, parseEnum, selectOf } from './auth-states'
import { ForgotScreen } from './forgot-screen'

const CONTROLS = {
  state: selectOf({ label: 'State', values: EForgotState, fallback: EForgotState.Idle }),
}

export function ForgotPasswordRoute() {
  const values = usePrototype(CONTROLS)
  return (
    <ForgotScreen
      state={parseEnum({ values: EForgotState, raw: values.state, fallback: EForgotState.Idle })}
    />
  )
}
