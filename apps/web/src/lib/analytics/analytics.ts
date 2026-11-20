import posthog from 'posthog-js'

import { isDesktopHost } from '@/features/desktop/desktop-attributes'
import { webBuild } from '@/lib/build-info'

const POSTHOG_TOKEN = 'phc_q27hvgM8kSbwyjca72m3v7QexFE25FfFG8n529zM2WqL'
const POSTHOG_UI_HOST = 'https://us.posthog.com'
const SHORT_SHA_LENGTH = 7

export interface SuperProps {
  surface: 'mac' | 'web'
  interface_version: string
}

export interface AnalyticsClient {
  capture: (event: string, props: Record<string, unknown>) => void
  identify: (userId: string, props: Record<string, unknown>) => void
  reset: () => void
  captureException: (error: unknown, props?: Record<string, unknown>) => void
}

export type AnalyticsEnv = Record<string, string | undefined>

const buildEnv: AnalyticsEnv = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_POSTHOG_ENABLED: process.env.NEXT_PUBLIC_POSTHOG_ENABLED,
}

export function isAnalyticsEnabled(env: AnalyticsEnv = buildEnv): boolean {
  if (env.NODE_ENV === 'test') return false
  return env.NODE_ENV === 'production' || env.NEXT_PUBLIC_POSTHOG_ENABLED === '1'
}

export function superPropsOf({ host, commit }: { host: object; commit: string }): SuperProps {
  return {
    surface: isDesktopHost(host) ? 'mac' : 'web',
    interface_version: commit.slice(0, SHORT_SHA_LENGTH),
  }
}

const posthogClient: AnalyticsClient = {
  capture: (event, props) => posthog.capture(event, props),
  identify: (userId, props) => posthog.identify(userId, props),
  reset: () => posthog.reset(),
  captureException: (error, props) => posthog.captureException(error, props),
}

let client: AnalyticsClient | undefined

export function initAnalytics(options: { enabled?: boolean; client?: AnalyticsClient } = {}): void {
  if (client !== undefined) return
  const enabled = options.enabled ?? isAnalyticsEnabled()
  if (!enabled) return
  if (options.client === undefined && typeof window === 'undefined') return
  if (options.client === undefined) {
    posthog.init(POSTHOG_TOKEN, {
      api_host: '/ingest',
      ui_host: POSTHOG_UI_HOST,
      autocapture: false,
      capture_pageview: 'history_change',
      capture_pageleave: true,
      disable_session_recording: true,
      capture_exceptions: true,
      person_profiles: 'identified_only',
    })
    posthog.register(superPropsOf({ host: window, commit: webBuild().commit }))
  }
  client = options.client ?? posthogClient
}

export function track(event: string, props: Record<string, unknown> = {}): void {
  client?.capture(event, props)
}

export function identifyUser(userId: string, props: Record<string, unknown> = {}): void {
  client?.identify(userId, props)
}

export function resetAnalytics(): void {
  client?.reset()
}

export function captureException(error: unknown, props: Record<string, unknown> = {}): void {
  if (client === undefined) initAnalytics()
  client?.captureException(error, props)
}

export function isAnalyticsReady(): boolean {
  return client !== undefined
}

export function resetAnalyticsForTests(): void {
  client = undefined
}
