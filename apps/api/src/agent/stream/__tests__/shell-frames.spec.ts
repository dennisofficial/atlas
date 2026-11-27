import { describe, expect, it } from 'bun:test'
import { type ShellFrame, ShellFrameHold } from '../overlay/shell-frames'

const frame = (args: { shellId?: string; offset: number; text: string }): ShellFrame => ({
  type: 'shell-output',
  shellId: args.shellId ?? 'shell-a',
  offset: args.offset,
  text: args.text,
})

describe('shell frame delivery', () => {
  it('sends snapshot and held duplicates once across repeated resyncs', () => {
    const sent: ShellFrame[] = []
    const hold = new ShellFrameHold((item) => {
      sent.push(item)
      return true
    })
    const item = frame({ offset: 0, text: 'hello' })
    hold.hold(item)
    hold.flush([item])
    hold.flush([item])
    expect(sent).toEqual([item])
  })

  it('orders overlaps per shell and slices only new character ranges', () => {
    const sent: ShellFrame[] = []
    const hold = new ShellFrameHold((item) => {
      sent.push(item)
      return true
    })
    hold.hold(frame({ offset: 2, text: '😀def' }))
    hold.hold(frame({ shellId: 'shell-b', offset: 2, text: 'cde' }))
    hold.flush([
      frame({ offset: 0, text: 'ab😀' }),
      frame({ shellId: 'shell-b', offset: 0, text: 'abc' }),
    ])
    expect(sent.filter((item) => item.shellId === 'shell-a')).toEqual([
      frame({ offset: 0, text: 'ab😀' }),
      frame({ offset: 4, text: 'def' }),
    ])
    expect(sent.filter((item) => item.shellId === 'shell-b')).toEqual([
      frame({ shellId: 'shell-b', offset: 0, text: 'abc' }),
      frame({ shellId: 'shell-b', offset: 3, text: 'de' }),
    ])
  })

  it('retains the same bounded tail as the source while delivery is blocked', () => {
    let accepting = false
    const sent: ShellFrame[] = []
    const hold = new ShellFrameHold((item) => {
      if (!accepting) return false
      sent.push(item)
      return true
    })
    for (let offset = 0; offset < 300; offset += 1) {
      hold.hold(frame({ offset, text: 'x' }))
    }
    accepting = true
    hold.drain()
    expect(sent).toHaveLength(256)
    expect(sent[0]?.offset).toBe(44)
    expect(sent.at(-1)?.offset).toBe(299)
  })

  it('keeps the unsent suffix without advancing delivery on rejection', () => {
    let accepting = false
    const sent: ShellFrame[] = []
    const hold = new ShellFrameHold((item) => {
      if (!accepting) return false
      sent.push(item)
      return true
    })
    const items = [frame({ offset: 0, text: 'ab' }), frame({ offset: 2, text: 'cd' })]
    hold.flush(items)
    expect(sent).toEqual([])
    accepting = true
    hold.drain()
    hold.flush(items)
    expect(sent).toEqual(items)
  })
})
