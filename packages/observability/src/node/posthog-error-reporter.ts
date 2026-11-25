import type { PostHog } from 'posthog-node'

import { ErrorReporter, type ErrorReportProperties } from '../errors/error-reporter'
import { SERVER_ERROR_DISTINCT_ID } from './posthog-config'

export class PosthogErrorReporter extends ErrorReporter {
  private readonly client: PostHog

  constructor(args: { client: PostHog }) {
    super()
    this.client = args.client
  }

  report(args: { error: Error; properties: ErrorReportProperties }): void {
    try {
      this.client.captureException(args.error, SERVER_ERROR_DISTINCT_ID, args.properties)
    } catch {
      return
    }
  }
}
