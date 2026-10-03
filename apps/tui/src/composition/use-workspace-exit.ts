import { useRenderer } from '@opentui/react'
import { useRef } from 'react'

import { closeConversation } from './open-conversation'
import { useExitGuard } from './use-exit-guard'
import type { WorkspaceProps } from './workspace-props'

type ExitProps = Pick<WorkspaceProps, 'localApp' | 'cloudSession' | 'onRestart'>

export const DETACHED_EXIT_LINE =
  'detached — turn keeps running; filesystem persists via snapshot; services die on park'

export function useWorkspaceExit(args: { props: ExitProps }) {
  const { props } = args
  const renderer = useRenderer()
  const restarting = useRef(false)

  const leave = () => {
    if (restarting.current && props.onRestart !== null) {
      props.onRestart()
      return
    }
    void closeConversation()
    renderer.destroy()
  }

  const handleDetach = () => {
    props.cloudSession?.close()
    void closeConversation()
    renderer.destroy()
    process.stdout.write(`${DETACHED_EXIT_LINE}\n`)
  }

  const exitGuard = useExitGuard({
    onKeepShells: leave,
    onExit: () => {
      props.localApp.prepareClose({ stopShells: true })
      leave()
    },
  })

  return { renderer, restarting, exitGuard, handleDetach }
}
