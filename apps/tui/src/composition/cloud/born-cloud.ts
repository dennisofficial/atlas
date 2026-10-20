import { choiceValueOf, EHarnessPlacement, ERunner, ESettingId, type ThreadId } from '@dltech/atlas-core'
import { cloudProvisioningConfigured } from '@dltech/atlas-harness'

import { ENoticeTone, NOTICE_WARN_MS, notify } from '../../ui/notice-store'
import type { AtlasApp } from '../compose'
import type { SendArgs } from '../conversation-types'
import type { BirthPreflight } from './bridge-factory'
import type { ProjectResolution } from './use-project-resolution'
import { bornPlacementChip } from './born-placement-chip'

export const CLOUD_NOT_CONFIGURED_NOTICE =
  'cloud sandboxes are not configured yet — set up your Vercel account under settings (ctrl+o) › cloud'

export const SIGN_IN_TO_BIRTH_NOTICE =
  'sign in to Atlas Cloud to start a session — pods lease your model tokens and signing key from it'

export type BornCloudArgs = {
  app: AtlasApp
  threadId: ThreadId
  choice?: ERunner | undefined
  arrival: SendArgs
  preflightBirth?: BirthPreflight | undefined
  requireSignIn: () => void
  resolveProject: () => Promise<ProjectResolution>
  birthCloud: (args: { threadId: ThreadId; runner: ERunner; projectId: string | null }) => void
}

export function rememberPlacement(args: { app: Pick<AtlasApp, 'settings'>; runner: ERunner }): void {
  args.app.settings.set({ id: ESettingId.LastBornPlacement, value: args.runner })
}

export function preferredRunner(app: Pick<AtlasApp, 'settings'>): ERunner {
  const chosen = choiceValueOf({
    resolution: app.settings.snapshot().resolution,
    id: ESettingId.LastBornPlacement,
    fallback: ERunner.Local,
  })
  return chosen === ERunner.Vercel ? ERunner.Vercel : ERunner.Local
}

export const vercelConfigured = (app: Pick<AtlasApp, 'settings' | 'secrets'>): boolean =>
  cloudProvisioningConfigured({ settings: app.settings, secrets: app.secrets })

export function notifyVercelUnconfigured(): void {
  notify({ key: 'born-cloud-unconfigured', text: CLOUD_NOT_CONFIGURED_NOTICE, tone: ENoticeTone.Info, ttlMs: NOTICE_WARN_MS })
}

export async function bornWith(args: BornCloudArgs): Promise<boolean> {
  const { app, threadId } = args

  if (app.cloud.session() === null) {
    notify({ key: 'born-sign-in', text: SIGN_IN_TO_BIRTH_NOTICE, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
    args.requireSignIn()
    return false
  }

  const runner = args.choice ?? preferredRunner(app)

  if (runner === ERunner.Vercel && !vercelConfigured(app)) {
    notifyVercelUnconfigured()
    return false
  }

  const refusal = (await args.preflightBirth?.({ runner })) ?? null
  if (refusal !== null) {
    notify({ key: 'born-cloud-preflight', text: refusal, tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })
    return false
  }

  const resolution = await args.resolveProject()
  if (resolution === 'cancelled') return false

  bornPlacementChip(app).set({
    threadId,
    harness: EHarnessPlacement.Cloud,
    runner,
    provisioning: true,
    arrival: args.arrival,
  })
  args.birthCloud({ threadId, runner, projectId: resolution.projectId })
  return true
}
