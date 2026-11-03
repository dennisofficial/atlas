export const RG_PATH_ENV = 'ATLAS_RG_PATH'

export type DaemonOpsDeps = {
  env: Record<string, string | undefined>
  home: string
}

export const ripgrepOf = (deps: DaemonOpsDeps): string => deps.env[RG_PATH_ENV] ?? 'rg'
