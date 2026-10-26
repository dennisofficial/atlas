'use client'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import {
  SIGN_IN_METHODS_BOTH,
  SIGN_IN_METHODS_GOOGLE_ONLY,
  SIGN_IN_METHODS_PASSWORD_ONLY,
} from '../fixtures/settings-account'
import { AccountPage } from '../pages/account'

const METHODS = {
  both: SIGN_IN_METHODS_BOTH,
  'google-only': SIGN_IN_METHODS_GOOGLE_ONLY,
  'password-only': SIGN_IN_METHODS_PASSWORD_ONLY,
}

const CONTROLS = {
  methods: {
    type: 'select',
    label: 'Sign-in methods',
    options: Object.keys(METHODS),
    default: 'both',
  },
} satisfies Record<string, Control>

export function AccountTweaked() {
  const { methods } = usePrototype(CONTROLS)
  return (
    <AccountPage
      key={methods}
      signInMethods={optionOf({ table: METHODS, key: methods, fallback: SIGN_IN_METHODS_BOTH })}
    />
  )
}
