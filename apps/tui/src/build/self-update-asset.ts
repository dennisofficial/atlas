import { compareSemver, type Semver } from '@dltech/atlas-core'

export function assetNameFor(args: { platform: string; arch: string }): string | null {
  if (args.platform === 'darwin' && args.arch === 'arm64') return 'atlas-darwin-arm64'
  if (args.platform === 'darwin' && args.arch === 'x64') return 'atlas-darwin-x64'
  if (args.platform === 'linux' && args.arch === 'x64') return 'atlas-linux-x64'
  return null
}

export function nextBinaryPathFor(execPath: string): string {
  return `${execPath}.next`
}

export function stagedVersionMarkerPathFor(execPath: string): string {
  return `${nextBinaryPathFor(execPath)}.version`
}

const SHA256_SIDECAR = /^([0-9a-f]{64})\b/i

export function sha256HexOf(sidecarText: string): string | null {
  const match = SHA256_SIDECAR.exec(sidecarText.trim())
  return match?.[1]?.toLowerCase() ?? null
}

export function verifySha256(args: { data: Uint8Array; sidecarText: string }): boolean {
  const expected = sha256HexOf(args.sidecarText)
  if (expected === null) return false

  const actual = new Bun.CryptoHasher('sha256').update(args.data).digest('hex')
  return actual === expected
}

export function shouldStage(args: { stagedVersion: Semver | null; targetVersion: Semver }): boolean {
  if (args.stagedVersion === null) return true
  return compareSemver(args.stagedVersion, args.targetVersion) < 0
}
