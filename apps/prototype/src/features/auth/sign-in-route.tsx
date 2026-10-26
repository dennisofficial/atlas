'use client'

import { usePrototype } from '@/proto/use-prototype'

import { ESignInContext, ESignInState, parseEnum, selectOf } from './auth-states'
import { SignInScreen } from './sign-in-screen'

const CONTROLS = {
  state: selectOf({ label: 'State', values: ESignInState, fallback: ESignInState.Idle }),
  context: selectOf({ label: 'Context', values: ESignInContext, fallback: ESignInContext.Default }),
}

export function SignInRoute() {
  const values = usePrototype(CONTROLS)
  return (
    <SignInScreen
      state={parseEnum({ values: ESignInState, raw: values.state, fallback: ESignInState.Idle })}
      context={parseEnum({
        values: ESignInContext,
        raw: values.context,
        fallback: ESignInContext.Default,
      })}
    />
  )
}
