import { describe, expect, it } from 'bun:test'
import { failureAnnotationsOf } from './github-check-annotations'

const failure = (over: Record<string, unknown>) => ({ annotation_level: 'failure', ...over })

describe('failureAnnotationsOf', () => {
  it('keeps failure-level annotations with their location and drops the rest', () => {
    const kept = failureAnnotationsOf([
      failure({ path: 'src/a.ts', start_line: 12, message: 'Type error', title: 'TS2322' }),
      { annotation_level: 'notice', message: 'runner notice' },
      { annotation_level: 'warning', message: 'a warning' },
    ])

    expect(kept).toEqual([{ path: 'src/a.ts', line: 12, message: 'Type error', title: 'TS2322' }])
  })

  it('drops the generic exit-code message and blank messages', () => {
    const kept = failureAnnotationsOf([
      failure({ message: 'Process completed with exit code 1.' }),
      failure({ message: 'Process completed with exit code 127' }),
      failure({ message: '   ' }),
      failure({ message: null }),
      failure({ message: 'one or more CI checks did not pass' }),
    ])

    expect(kept).toEqual([{ message: 'one or more CI checks did not pass' }])
  })

  it('caps at three annotations and clips long messages to 300 characters', () => {
    const kept = failureAnnotationsOf([
      failure({ message: 'x'.repeat(400) }),
      failure({ message: 'b' }),
      failure({ message: 'c' }),
      failure({ message: 'd' }),
    ])

    expect(kept).toHaveLength(3)
    expect(kept[0]?.message).toHaveLength(300)
    expect(kept[0]?.message.endsWith('…')).toBe(true)
  })

  it('omits the line when the annotation has no path', () => {
    expect(failureAnnotationsOf([failure({ start_line: 4, message: 'boom' })])).toEqual([
      { message: 'boom' },
    ])
  })

  it('returns an empty list when nothing survives', () => {
    expect(failureAnnotationsOf([])).toEqual([])
  })
})
