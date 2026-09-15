export type ClientVersion = readonly [number, number, number]

export function parseClientVersion(raw: string): ClientVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw)
  if (!match) return null
  const major = match[1]
  const minor = match[2]
  const patch = match[3]
  if (major === undefined || minor === undefined || patch === undefined) return null
  return [Number(major), Number(minor), Number(patch)]
}

export function isBelowMinimum(args: {
  minimum: ClientVersion
  received: ClientVersion
}): boolean {
  const [minimumMajor, minimumMinor, minimumPatch] = args.minimum
  const [receivedMajor, receivedMinor, receivedPatch] = args.received
  if (receivedMajor !== minimumMajor) return receivedMajor < minimumMajor
  if (receivedMinor !== minimumMinor) return receivedMinor < minimumMinor
  return receivedPatch < minimumPatch
}
