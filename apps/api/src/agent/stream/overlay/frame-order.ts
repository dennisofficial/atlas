import { compareFrameStamp, type FrameStamp } from '@dltech/atlas-protocol'

export const laterStamp = (args: {
  left: FrameStamp | undefined
  right: FrameStamp | undefined
}): FrameStamp | undefined => {
  const { left, right } = args
  if (left === undefined) return right
  if (right === undefined) return left
  return compareFrameStamp({ left, right }) >= 0 ? left : right
}

export const atOrBefore = (args: { at: FrameStamp; limit: FrameStamp | undefined }): boolean =>
  args.limit !== undefined && compareFrameStamp({ left: args.at, right: args.limit }) <= 0

export class FrameOrder {
  private closed: FrameStamp | undefined
  private applied: FrameStamp | undefined

  isStale(at: FrameStamp): boolean {
    return atOrBefore({ at, limit: this.closed }) || atOrBefore({ at, limit: this.applied })
  }

  isClosed(at: FrameStamp): boolean {
    return atOrBefore({ at, limit: this.closed })
  }

  apply(at: FrameStamp): void {
    this.applied = laterStamp({ left: this.applied, right: at })
  }

  closeThrough(at: FrameStamp): void {
    this.closed = laterStamp({ left: this.closed, right: at })
    this.apply(at)
  }

  supersede(): void {
    this.closed = laterStamp({ left: this.closed, right: this.applied })
  }
}
