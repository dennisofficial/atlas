import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { ECloudAction } from '../ui/components/settings/cloud'

export type CloudPageControl = {
  action: ECloudAction | null
  handleResetAction: () => void
  handleDisarmAction: () => void
  handleActivate: () => void
  handleKey: (key: KeyEvent, context: CloudKeyContext) => boolean
}

export type CloudKeyContext = {
  onCloudPage: boolean
  signedIn: boolean
  rowIndex: number
  rowCount: number
}

export function cloudActionsOf(args: {
  githubConnected: boolean
  signingKeyRegistered: boolean
}): readonly ECloudAction[] {
  return [
    ECloudAction.SignOut,
    ECloudAction.Github,
    ...(args.githubConnected ? [ECloudAction.SigningKey] : []),
    ...(args.githubConnected && args.signingKeyRegistered ? [ECloudAction.SigningKeyRemove] : []),
  ]
}

export function useCloudPage(args: {
  githubConnected: boolean
  signingKeyRegistered: boolean
  onSignOut: () => void
  onGithubActivate: () => void
  onSigningKeyActivate: () => void
  onSigningKeyRemove: () => void
}): CloudPageControl {
  const {
    githubConnected,
    signingKeyRegistered,
    onSignOut,
    onGithubActivate,
    onSigningKeyActivate,
    onSigningKeyRemove,
  } = args
  const [held, setAction] = useState<ECloudAction | null>(ECloudAction.SignOut)
  const actions = useMemo(
    () => cloudActionsOf({ githubConnected, signingKeyRegistered }),
    [githubConnected, signingKeyRegistered],
  )
  const lastAction = actions[actions.length - 1] ?? ECloudAction.SignOut
  const action = held !== null && !actions.includes(held) ? lastAction : held

  useEffect(() => {
    if (held !== null && !actions.includes(held)) setAction(lastAction)
  }, [held, actions, lastAction])

  const handleResetAction = useCallback(() => setAction(ECloudAction.SignOut), [])

  const handleDisarmAction = useCallback(() => setAction(null), [])

  const handleActivate = useCallback(() => {
    if (action === ECloudAction.Github) {
      onGithubActivate()
      return
    }
    if (action === ECloudAction.SigningKey) {
      onSigningKeyActivate()
      return
    }
    if (action === ECloudAction.SigningKeyRemove) {
      onSigningKeyRemove()
      return
    }
    if (action === ECloudAction.SignOut) onSignOut()
  }, [action, onGithubActivate, onSignOut, onSigningKeyActivate, onSigningKeyRemove])

  const handleKey = useCallback(
    (key: KeyEvent, context: CloudKeyContext): boolean => {
      if (!context.onCloudPage || !context.signedIn) return false
      if (key.name !== 'up' && key.name !== 'down') return false

      const delta = key.name === 'down' ? 1 : -1

      if (action !== null) {
        const next = actions.indexOf(action) + delta
        if (next >= actions.length) {
          if (context.rowCount === 0) return true
          setAction(null)
          return true
        }
        if (next >= 0) setAction(actions[next] ?? ECloudAction.SignOut)
        return true
      }

      if (delta < 0 && context.rowIndex === 0) {
        setAction(lastAction)
        return true
      }

      return false
    },
    [action, actions, lastAction],
  )

  return { action, handleResetAction, handleDisarmAction, handleActivate, handleKey }
}
