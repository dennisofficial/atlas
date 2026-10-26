'use client'

import { usePrototype } from '@/proto/use-prototype'

import { ESignUpState, parseEnum, selectOf } from './auth-states'
import { SignUpScreen } from './sign-up-screen'

const CONTROLS = {
  state: selectOf({ label: 'State', values: ESignUpState, fallback: ESignUpState.Idle }),
}

export function SignUpRoute() {
  const values = usePrototype(CONTROLS)
  return (
    <SignUpScreen
      state={parseEnum({ values: ESignUpState, raw: values.state, fallback: ESignUpState.Idle })}
    />
  )
}
