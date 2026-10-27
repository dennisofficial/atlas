import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

export type AgentsOfflineCopy = { title: string; description: string }

export function agentsOfflineCopyOf(pod: PodStatus | null): AgentsOfflineCopy | null {
  switch (pod?.state) {
    case EPodState.None:
      return { title: 'No pod yet', description: 'Send a message to start a pod.' }
    case EPodState.Parked:
      return {
        title: 'Sandbox is asleep',
        description: 'Send a message to wake it. Live agent status returns once it is back.',
      }
    case EPodState.Booting:
      return {
        title: 'Waiting for the pod',
        description: 'Live agent status appears once the workspace is set up.',
      }
    case EPodState.Failed:
      return {
        title: 'Pod did not start',
        description: 'Live agent status appears once a pod is running.',
      }
    default:
      return null
  }
}
