'use client'

import { usePrototype } from '@/proto/use-prototype'

import { ESetupState, parseEnum, selectOf } from './auth-states'
import { SetupScreen } from './setup-screen'

const CONTROLS = {
  state: selectOf({
    label: 'State',
    values: ESetupState,
    fallback: ESetupState.CreateWorkspace,
  }),
}

export function SetupRoute() {
  const values = usePrototype(CONTROLS)
  return (
    <SetupScreen
      state={parseEnum({
        values: ESetupState,
        raw: values.state,
        fallback: ESetupState.CreateWorkspace,
      })}
    />
  )
}
