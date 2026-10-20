import React from 'react'

import { useClickRegion } from '../../hooks/use-click-region'
import { theme } from '../../theme'
import type { Span } from '../spans'
import { SettingsTextLine } from './rows'

export enum ESigningKeyView {
  Absent = 'absent',
  Registered = 'registered',
  ScopeMissing = 'scope-missing',
  Unavailable = 'unavailable',
  Busy = 'busy',
}

export type SigningKeyView = {
  state: ESigningKeyView
  fingerprintTail?: string
}

export type SigningKeyAccountView = {
  view: SigningKeyView
  activateRotateOrEnable: () => void
  activateRemove: () => void
}

export const hasSigningKey = (view: SigningKeyView): boolean =>
  view.state === ESigningKeyView.Registered ||
  (view.state === ESigningKeyView.Busy && view.fingerprintTail !== undefined)

export const fingerprintTailOf = (args: { publicKey: string }): string => {
  const line = args.publicKey.trim()
  const blob = line.split(/\s+/)[1] ?? line
  return blob.slice(-8)
}

const hint = (text: string): Span => ({ text, fg: theme.hint })

const valueOf = (view: SigningKeyView): Span[] => {
  if (view.state === ESigningKeyView.Busy) return [hint('working…')]
  if (view.state === ESigningKeyView.ScopeMissing) return [hint('reconnect GitHub to enable')]
  if (view.state === ESigningKeyView.Unavailable) return [hint("couldn't reach Atlas Cloud")]
  if (view.state === ESigningKeyView.Registered) {
    return [
      { text: 'on', fg: theme.hover },
      hint(` · …${view.fingerprintTail ?? ''} · ⏎ to rotate`),
    ]
  }
  return [{ text: 'off', fg: theme.hover }, hint(' · ⏎ to enable')]
}

const isActionable = (view: SigningKeyView): boolean =>
  view.state === ESigningKeyView.Absent ||
  view.state === ESigningKeyView.Registered ||
  view.state === ESigningKeyView.Unavailable

export function SigningKeyRow(props: {
  cells: number
  selected: boolean
  account: SigningKeyAccountView
}): React.ReactNode {
  const { account } = props
  const region = useClickRegion(isActionable(account.view) ? account.activateRotateOrEnable : undefined)

  return (
    <SettingsTextLine
      label="Commit signing"
      value={valueOf(account.view)}
      cells={props.cells}
      selected={props.selected}
      {...(region.wash.bg === undefined ? {} : { band: region.wash.bg })}
      press={region.handlers}
    />
  )
}
