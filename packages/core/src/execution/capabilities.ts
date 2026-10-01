export enum EPortExposure {
  None = 'none',
  Localhost = 'localhost',
  PublicDomain = 'public-domain',
}

export type EnvironmentCapabilities = {
  canPush: boolean
  gitIdentity: string | null
  gpgSigning: boolean
  dockerAvailable: boolean
  persistentFs: boolean
  serviceTtlSeconds: number | null
  portExposure: EPortExposure
  failures: readonly string[]
}
