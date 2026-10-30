import { isSameItem } from './same-item'
import { ESegmentKind, ETurnKind, type Segment, type Turn } from './transcript-turns'

const isShallowEqual = (previous: object, next: object): boolean => {
  const keys = Object.keys(previous)
  return (
    keys.length === Object.keys(next).length &&
    keys.every((key) =>
      Object.is(previous[key as keyof typeof previous], next[key as keyof typeof next]),
    )
  )
}

function isSameSegment(previous: Segment, next: Segment): boolean {
  if (previous.kind === ESegmentKind.Message) {
    return (
      next.kind === ESegmentKind.Message &&
      previous.id === next.id &&
      previous.final === next.final &&
      isSameItem({ previous: previous.item, next: next.item })
    )
  }
  return (
    next.kind === ESegmentKind.Work &&
    previous.id === next.id &&
    previous.running === next.running &&
    previous.stepCount === next.stepCount &&
    previous.startedAt === next.startedAt &&
    previous.endedAt === next.endedAt &&
    previous.items.length === next.items.length &&
    previous.items.every((item, index) => {
      const other = next.items[index]
      return other !== undefined && isSameItem({ previous: item, next: other })
    })
  )
}

export function isSameTurn(args: { previous: Turn; next: Turn }): boolean {
  const { previous, next } = args
  if (previous === next) return true
  if (previous.kind !== next.kind || previous.id !== next.id) return false
  switch (previous.kind) {
    case ETurnKind.User:
    case ETurnKind.Notice:
      return next.kind === previous.kind && isSameItem({ previous: previous.item, next: next.item })
    case ETurnKind.Report:
      return next.kind === ETurnKind.Report && isShallowEqual(previous.item, next.item)
    case ETurnKind.Agent:
      return (
        next.kind === ETurnKind.Agent &&
        previous.running === next.running &&
        previous.segments.length === next.segments.length &&
        previous.segments.every((segment, index) => {
          const other = next.segments[index]
          return other !== undefined && isSameSegment(segment, other)
        }) &&
        previous.spawns.length === next.spawns.length &&
        previous.spawns.every((spawn, index) => {
          const other = next.spawns[index]
          return other !== undefined && isShallowEqual(spawn, other)
        })
      )
  }
}
