export const RG_PATH_ENV = 'ATLAS_RG_PATH'
export const CLOUDFLARED_PATH = '/usr/local/bin/cloudflared'
export const PREVIEW_READY_TIMEOUT_MS = 20_000

export type DaemonOpsDeps = {
  env: Record<string, string | undefined>
  home: string
  cloudflaredPath?: string | undefined
  previewReadyTimeoutMs?: number | undefined
  previewsFile?: string | undefined
}

export const ripgrepOf = (deps: DaemonOpsDeps): string => deps.env[RG_PATH_ENV] ?? 'rg'
