import { CloudError } from '../cloud/cloud-transport'
import { CloudSignInRequiredError } from '../cloud/sign-in-required'

const OUTAGE_ADVICE =
  'Atlas Cloud holds the accounts, so model access stays dark until it answers again. Local work — reading the transcript, browsing threads, /settings — still works.'

const SIGN_IN_ADVICE = 'Sign in from the accounts overlay: press ctrl+a, or run /auth.'

export function cloudOutageMessage(error: unknown): string | null {
  if (error instanceof CloudSignInRequiredError) {
    return [error.message, '', SIGN_IN_ADVICE].join('\n')
  }
  if (!(error instanceof CloudError)) return null

  return [error.message, '', OUTAGE_ADVICE].join('\n')
}

export function isCloudOutage(error: unknown): boolean {
  return cloudOutageMessage(error) !== null
}
