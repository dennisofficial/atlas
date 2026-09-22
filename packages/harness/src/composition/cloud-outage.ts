import { CloudError } from '../cloud/cloud-transport'

const OUTAGE_ADVICE =
  'Atlas Cloud holds the accounts, so model access stays dark until it answers again. Local work — reading the transcript, browsing threads, /settings — still works.'

export function cloudOutageMessage(error: unknown): string | null {
  if (!(error instanceof CloudError)) return null

  return [error.message, '', OUTAGE_ADVICE].join('\n')
}

export function isCloudOutage(error: unknown): boolean {
  return cloudOutageMessage(error) !== null
}
