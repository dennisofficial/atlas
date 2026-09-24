import {
  ESettingId,
  ESettingKind,
  ESettingPage,
  type SettingDefinition,
} from '@dltech/atlas-core'

/**
 * The cloud-only settings: server-side per-user state, never read from local settings files.
 * They live here rather than in core's registry because the harness owns the cloud client that
 * serves them; the setting ids themselves stay in core's ESettingId for every call site.
 */
export const CLOUD_SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    id: ESettingId.VercelTeamId,
    page: ESettingPage.Cloud,
    group: 'Cloud sandboxes',
    label: 'Vercel team',
    description:
      'The team ID (team_…) the sandbox belongs to — Vercel scopes every sandbox call to a team and a project, and a personal team still has one. Find it in the team’s settings page, or run `vercel teams ls`.',
    environmentVariable: 'VERCEL_TEAM_ID',
    kind: ESettingKind.Text,
    fallback: '',
  },
  {
    id: ESettingId.VercelProjectId,
    page: ESettingPage.Cloud,
    group: 'Cloud sandboxes',
    label: 'Vercel project',
    description:
      'The project ID (prj_…) the sandbox is billed and listed under — any project on the team does, since sandboxes attach to it in name only. Find it in the project’s settings page.',
    environmentVariable: 'VERCEL_PROJECT_ID',
    kind: ESettingKind.Text,
    fallback: '',
  },
  {
    id: ESettingId.SandboxImage,
    page: ESettingPage.Cloud,
    group: 'Cloud sandboxes',
    label: 'Sandbox image',
    description:
      'The sandbox image a cloud conversation boots. Left unset, a released Atlas pins the published image to its own version so the sandbox’s serve matches it; point this at your own build of the image when your Vercel team cannot pull the published one.',
    environmentVariable: 'ATLAS_SANDBOX_IMAGE',
    kind: ESettingKind.Text,
    fallback: 'atlas-sandbox:latest',
  },
  {
    id: ESettingId.CloudUrl,
    page: ESettingPage.Hidden,
    group: 'Cloud',
    label: 'Cloud API',
    description:
      'Where the Atlas Cloud API lives — the backend a signed-in session syncs accounts, secrets and the user MCP layer with; signed out, the local vault is the whole store. The fallback is the production deployment; an Atlas contributor running apps/api next to the TUI points this at the local development server instead.',
    environmentVariable: 'ATLAS_CLOUD_URL',
    kind: ESettingKind.Text,
    fallback: 'https://api.byatlas.io',
  },
]

export const CLOUD_SETTING_IDS: readonly string[] = CLOUD_SETTING_DEFINITIONS.map(
  (definition) => definition.id,
)

export const isCloudSettingId = (id: string): boolean => CLOUD_SETTING_IDS.includes(id)
