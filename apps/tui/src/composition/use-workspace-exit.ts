import { useRenderer } from '@opentui/react'
import { useRef } from 'react'

import { DETACH_EXIT_LINE } from '../ui/exit-guard-model'
import { closeConversation } from './open-conversation'
import { useExitGuard } from './use-exit-guard'
import type { WorkspaceProps } from './workspace-props'

type ExitProps = Pick<WorkspaceProps, 'localApp' | 'cloudBridge' | 'cloudSession' | 'onRestart'>

export function useWorkspaceExit(args: { props: ExitProps }) {
  const { props } = args
  const renderer = useRenderer()
  const restarting = useRef(false)
  const cloud = props.cloudBridge !== null

  const leave = (): boolean => {
    if (restarting.current && props.onRestart !== null) {
      props.onRestart()
      return false
    }
    void closeConversation()
    renderer.destroy()
    return true
  }

  const exitGuard = useExitGuard({
    cloud,
    onKeepShells: () => void leave(),
    onExit: () => {
      props.localApp.prepareClose({ stopShells: true })
      void leave()
    },
    onDetach: () => {
      props.cloudSession?.close()
      if (leave()) process.stdout.write(`${DETACH_EXIT_LINE}\n`)
    },
  })

  return { renderer, restarting, exitGuard }
}
