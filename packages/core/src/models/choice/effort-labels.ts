import { EFFORT_LADDER, EEffort, type EffortMap } from '../effort-ladder'

export const EFFORT_RUNG_LABEL: Readonly<Record<EEffort, string>> = {
  [EEffort.Off]: 'Off',
  [EEffort.Minimal]: 'Minimal',
  [EEffort.Low]: 'Low',
  [EEffort.Medium]: 'Medium',
  [EEffort.High]: 'High',
  [EEffort.XHigh]: 'Extra high',
  [EEffort.Max]: 'Max',
}

const WIRE_LABEL: Readonly<Record<string, string>> = {
  none: 'None',
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
}

const THOUSAND = 1000

const tokensLabel = (tokens: number): string =>
  tokens < THOUSAND ? `${tokens} tokens` : `${Math.round(tokens / THOUSAND)}k tokens`

export function effortLabelOf(args: { map: EffortMap | undefined; rung: EEffort }): string {
  const wire = args.map?.[args.rung]
  if (typeof wire === 'number') return `${EFFORT_RUNG_LABEL[args.rung]} · ${tokensLabel(wire)}`
  if (typeof wire === 'string') return WIRE_LABEL[wire] ?? wire
  return EFFORT_RUNG_LABEL[args.rung]
}

export function effortLabelsOf(map: EffortMap | undefined): Partial<Record<EEffort, string>> {
  if (map === undefined) return {}

  const labels: Partial<Record<EEffort, string>> = {}
  for (const rung of EFFORT_LADDER) {
    if (map[rung] === undefined) continue
    labels[rung] = effortLabelOf({ map, rung })
  }
  return labels
}
