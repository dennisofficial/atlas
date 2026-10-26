import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

export type OfflineCopy = { title: string; description: string }

export enum ETabSubject {
  Changes = 'changes',
  Files = 'files',
}

const ARRIVAL: Record<ETabSubject, string> = {
  [ETabSubject.Changes]: 'Changes appear',
  [ETabSubject.Files]: 'Files appear',
}

export function offlineCopyOf(args: { pod: PodStatus | null; subject: ETabSubject }): OfflineCopy {
  const arrival = ARRIVAL[args.subject]

  switch (args.pod?.state) {
    case EPodState.None:
      return {
        title: 'No pod yet',
        description: 'Send a message to start a pod.',
      }
    case EPodState.Parked:
      return {
        title: 'Sandbox is asleep',
        description: `Send a message to wake it. ${arrival} once it is back.`,
      }
    case EPodState.Booting:
      return {
        title: 'Waiting for the pod',
        description: `${arrival} once the workspace is set up.`,
      }
    case EPodState.Failed:
      return {
        title: 'Pod did not start',
        description: `${arrival} once a pod is running.`,
      }
    default:
      return {
        title: 'Connecting to the pod',
        description: `${arrival} as soon as it answers.`,
      }
  }
}
