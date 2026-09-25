import { CloudError, isCloudRefusal } from '../cloud/cloud-transport'

const OUTAGE_ADVICE =
  'Atlas Cloud holds the accounts, so model access stays dark until it answers again. Local work — reading the transcript, browsing threads, /settings — still works.'

const REFUSAL_ADVICE =
  'Atlas Cloud rejected the session — the sign-in is gone and every cloud cache with it. Sign back in from the accounts overlay: press ctrl+a, or run /auth.'

export function cloudOutageMessage(error: unknown): string | null {
  if (!(error instanceof CloudError)) return null

  if (isCloudRefusal(error)) return [error.message, '', REFUSAL_ADVICE].join('\n')
  return [error.message, '', OUTAGE_ADVICE].join('\n')
}

export function isCloudOutage(error: unknown): boolean {
  return cloudOutageMessage(error) !== null
}
