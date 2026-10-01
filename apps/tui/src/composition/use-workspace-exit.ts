import { useRenderer } from '@opentui/react'
import { useRef } from 'react'

import { DETACH_EXIT_LINE } from '../ui/exit-guard-model'
import { closeConversation } from './open-conversation'
import { useExitGuard } from './use-exit-guard'
import type { WorkspaceProps } from './workspace-props'

type ExitProps = Pick<WorkspaceProps, 'cloudBridge' | 'cloudSession' | 'onRestart'>

export function useWorkspaceExit(args: { props: ExitProps }) {
  const { props } = args
  const renderer = useRenderer()
  const restarting = useRef(false)
  const cloud = props.cloudBridge !== null
  const exitGuard = useExitGuard({
    cloud,
    onExit: () => {
      if (restarting.current && props.onRestart !== null) {
        props.onRestart()
        return
      }
      void closeConversation()
      renderer.destroy()
    },
    onDetach: () => {
      props.cloudSession?.close()
      if (restarting.current && props.onRestart !== null) {
        props.onRestart()
        return
      }
      void closeConversation()
      renderer.destroy()
      process.stdout.write(`${DETACH_EXIT_LINE}\n`)
    },
  })

  return { renderer, restarting, exitGuard }
}
