const CHECKED_ENUMS = ['EClientFrame', 'EServeFrame', 'EClientRequest'] as const

export type WireFacts = {
  version: number
  minVersion: number
  members: ReadonlyMap<string, Set<string>>
}

const numberConst = (args: { source: string; name: string }): number | undefined => {
  const match = new RegExp(`export const ${args.name} = (\\d+)`).exec(args.source)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

const enumMembers = (args: { source: string; name: string }): Set<string> => {
  const body = new RegExp(`export enum ${args.name} \\{([^}]*)\\}`).exec(args.source)?.[1] ?? ''
  return new Set([...body.matchAll(/=\s*'([^']+)'/g)].map((match) => match[1] ?? ''))
}

export const wireFactsOf = (source: string): WireFacts => {
  const version = numberConst({ source, name: 'CHANNEL_PROTOCOL_VERSION' })
  if (version === undefined) throw new Error(`channel-wire.ts declares no CHANNEL_PROTOCOL_VERSION`)
  return {
    version,
    minVersion: numberConst({ source, name: 'CHANNEL_PROTOCOL_MIN_VERSION' }) ?? version,
    members: new Map(CHECKED_ENUMS.map((name) => [name, enumMembers({ source, name })])),
  }
}

export const skewViolations = (args: { base: WireFacts; head: WireFacts }): string[] => {
  const { base, head } = args
  const violations: string[] = []
  if (head.minVersion > base.version) {
    violations.push(
      `CHANNEL_PROTOCOL_MIN_VERSION ${head.minVersion} drops protocol ${base.version}, which the last build speaks — serves already in sandboxes would be refused. Keep the minimum at or below ${base.version}.`,
    )
  }
  if (head.version - base.version > 1) {
    violations.push(
      `CHANNEL_PROTOCOL_VERSION moved ${base.version} → ${head.version}; bump by one.`,
    )
  }
  for (const name of CHECKED_ENUMS) {
    const removed = [...(base.members.get(name) ?? [])].filter(
      (member) => !(head.members.get(name)?.has(member) ?? false),
    )
    if (removed.length > 0 && head.version === base.version) {
      violations.push(
        `${name} lost ${removed.join(', ')} without a protocol bump — a removal is breaking.`,
      )
    }
  }
  return violations
}
