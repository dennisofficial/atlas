import React from 'react'

import { useClickRegion } from '../../hooks/use-click-region'
import { ESettingsLogin, isSettlingLogin, type SettingsLoginState } from '../../settings-login-model'
import { theme } from '../../theme'
import type { Span } from '../spans'
import { SettingsTextLine } from './rows'

export type GithubAccountView = {
  connection: { login: string } | null
  unreachable: boolean
  flow: SettingsLoginState
  onActivate: () => void
  onOpenUrl: () => void
}

const STATUS_LABEL: Readonly<Record<ESettingsLogin, string | null>> = {
  [ESettingsLogin.Idle]: null,
  [ESettingsLogin.Asking]: 'asking GitHub for a code…',
  [ESettingsLogin.Prompting]: 'code below — waiting for approval…',
  [ESettingsLogin.Finishing]: 'connecting…',
}

const valueOf = (args: { signedIn: boolean; view: GithubAccountView }): Span[] => {
  const { view } = args
  if (!args.signedIn) return [{ text: 'sign in to Atlas Cloud first', fg: theme.hint }]

  const status = STATUS_LABEL[view.flow.status]
  if (status !== null) return [{ text: status, fg: theme.hint }]

  if (view.unreachable) return [{ text: "couldn't reach Atlas Cloud", fg: theme.hint }]

  if (view.connection !== null) {
    return [
      { text: `@${view.connection.login}`, fg: theme.hover },
      { text: ' · connected · ⏎ to disconnect', fg: theme.hint },
    ]
  }

  return [{ text: 'not connected · ⏎ to connect', fg: theme.hint }]
}

export function GithubRow(props: {
  cells: number
  signedIn: boolean
  selected: boolean
  view: GithubAccountView
}): React.ReactNode {
  const { view } = props
  const actionable = props.signedIn && !view.unreachable && !isSettlingLogin(view.flow.status)
  const region = useClickRegion(actionable ? view.onActivate : undefined)

  return (
    <SettingsTextLine
      label="GitHub"
      value={valueOf({ signedIn: props.signedIn, view })}
      cells={props.cells}
      selected={props.selected}
      {...(region.wash.bg === undefined ? {} : { band: region.wash.bg })}
      press={region.handlers}
    />
  )
}
