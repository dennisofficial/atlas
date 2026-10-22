import type { SettingChanges } from '@/lib/cloud-settings'
import { NO_DEFAULT_MODEL } from '@/features/settings/fixtures/settings-workspace'

export type GeneralDraft = {
  name: string
  slug: string
  region: string
  model: string
}

export type GeneralSave = {
  organization: { name?: string; slug?: string } | null
  settings: SettingChanges
}

export const modelOfSetting = (stored: string): string =>
  stored === '' ? NO_DEFAULT_MODEL : stored

export const sanitizeSlug = (raw: string): string => raw.toLowerCase().replace(/[^a-z0-9-]/g, '')

export function planGeneralSave({
  saved,
  draft,
}: {
  saved: GeneralDraft
  draft: GeneralDraft
}): GeneralSave {
  const organization = {
    ...(draft.name !== saved.name ? { name: draft.name.trim() } : {}),
    ...(draft.slug !== saved.slug ? { slug: draft.slug } : {}),
  }
  const settings: SettingChanges = {
    ...(draft.region !== saved.region ? { 'workspace.defaultRegion': draft.region } : {}),
    ...(draft.model !== saved.model
      ? { 'workspace.defaultModel': draft.model === NO_DEFAULT_MODEL ? null : draft.model }
      : {}),
  }
  return { organization: Object.keys(organization).length === 0 ? null : organization, settings }
}

export function validateGeneralDraft(draft: GeneralDraft): string | null {
  if (draft.name.trim() === '') return 'Workspace name is required'
  if (draft.slug === '') return 'Workspace slug is required'
  return null
}
