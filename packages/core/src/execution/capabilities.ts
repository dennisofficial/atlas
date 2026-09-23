export enum EPortExposure {
  None = 'none',
  Localhost = 'localhost',
  PublicDomain = 'public-domain',
}

/**
 * What a location can actually do, probed by whoever materialized it rather than assumed from its
 * name: a cloud sandbox with a brokered token can push, one without cannot, and the agent plans
 * its verification strategy from the difference. `failures` carries the profile steps that did
 * not apply, so a gap is read here at boot instead of being discovered mid-task.
 */
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

const yesNo = (value: boolean): string => (value ? 'yes' : 'no')

const exposureTextOf = (exposure: EPortExposure): string => {
  if (exposure === EPortExposure.PublicDomain) return 'a public URL the operator can open'
  if (exposure === EPortExposure.Localhost) return 'localhost on the operator’s machine'
  return 'nothing — published ports are unreachable'
}

export function capabilitiesNote(capabilities: EnvironmentCapabilities): string {
  const lines = [
    'This environment’s probed capabilities:',
    `- git push/PR/CI from here: ${yesNo(capabilities.canPush)}`,
    `- git identity: ${capabilities.gitIdentity ?? 'none — commits will fail until one is set'}`,
    `- commit signing (gpg): ${yesNo(capabilities.gpgSigning)}`,
    `- docker available: ${yesNo(capabilities.dockerAvailable)}`,
    `- filesystem persists across stops: ${yesNo(capabilities.persistentFs)}`,
    `- a published port is reachable at: ${exposureTextOf(capabilities.portExposure)}`,
  ]
  if (capabilities.serviceTtlSeconds !== null) {
    lines.push(`- services stop with the sandbox, about ${Math.round(capabilities.serviceTtlSeconds / 60)} minutes after the last activity`)
  } else {
    lines.push('- services stop with the sandbox')
  }
  for (const failure of capabilities.failures) {
    lines.push(`- environment setup step failed: ${failure}`)
  }
  return lines.join('\n')
}
