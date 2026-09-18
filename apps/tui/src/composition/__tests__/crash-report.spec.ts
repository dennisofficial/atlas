import { describe, expect, it } from 'bun:test'

import { annotateCrashStack, codeFrame, isOwnFrame, parseCrashFrame } from '../crash-report'

const SOURCE = [
  'const a = 1',
  'const b = 2',
  'export const App = () => {',
  '  return render(Workspace, { covered: true })',
  '}',
  '',
].join('\n')

describe('parseCrashFrame', () => {
  it('reads a named v8 frame', () => {
    expect(parseCrashFrame('    at App (/repo/apps/tui/src/app.tsx:265:7)')).toEqual({
      file: '/repo/apps/tui/src/app.tsx',
      line: 265,
      column: 7,
    })
  })

  it('reads an anonymous frame', () => {
    expect(parseCrashFrame('    at /repo/apps/tui/src/app.tsx:12:3')).toEqual({
      file: '/repo/apps/tui/src/app.tsx',
      line: 12,
      column: 3,
    })
  })

  it('ignores the message line', () => {
    expect(parseCrashFrame('TypeError: jsxDEV_7x81h0kn is not a function.')).toBeNull()
  })
})

describe('isOwnFrame', () => {
  it('keeps a source frame', () => {
    expect(isOwnFrame({ file: '/repo/apps/tui/src/app.tsx', line: 1, column: 1 })).toBe(true)
  })

  it('drops a dependency frame', () => {
    const frame = { file: '/repo/node_modules/react-reconciler/cjs/x.js', line: 1, column: 1 }
    expect(isOwnFrame(frame)).toBe(false)
  })

  it('drops a frame inside the compiled bundle', () => {
    expect(isOwnFrame({ file: '/$bunfs/root/atlas', line: 1, column: 1 })).toBe(false)
  })
})

describe('codeFrame', () => {
  it('points at the failing line and column', () => {
    const framed = codeFrame({ source: SOURCE, line: 4, column: 10, cells: 80 })

    expect(framed.some((line) => line.includes('› 4 │   return render'))).toBe(true)
    expect(framed.filter((line) => line.trimEnd().endsWith('^'))).toHaveLength(1)
  })

  it('answers with nothing when the line is off the end', () => {
    expect(codeFrame({ source: SOURCE, line: 99, column: 1, cells: 80 })).toEqual([])
  })

  it('clips a line to the width it was given', () => {
    const wide = codeFrame({ source: `${'x'.repeat(400)}\n`, line: 1, column: 1, cells: 40 })

    expect(wide.every((line) => line.length <= 40)).toBe(true)
  })
})

describe('annotateCrashStack', () => {
  const stack = [
    "TypeError: jsxDEV_7x81h0kn is not a function. (In 'jsxDEV_7x81h0kn(Workspace, { covered: props.covered === !0 })')",
    '    at App (/repo/apps/tui/src/app.tsx:4:10)',
    '    at renderWithHooks (/repo/node_modules/react-reconciler/cjs/react-reconciler.production.js:2655:23)',
  ].join('\n')

  it('inlines the source the frame points at', () => {
    const annotated = annotateCrashStack({
      stack,
      read: (file) => (file === '/repo/apps/tui/src/app.tsx' ? SOURCE : null),
      cells: 100,
    })

    expect(annotated).toContain('covered: true')
    expect(annotated).toContain('at App (/repo/apps/tui/src/app.tsx:4:10)')
  })

  it('leaves a dependency frame alone', () => {
    const annotated = annotateCrashStack({ stack, read: () => SOURCE, cells: 100 })

    expect(annotated).not.toContain('react-reconciler.production.js:2655:23\n    ›')
  })

  it('hands the stack back untouched when no source can be read', () => {
    expect(annotateCrashStack({ stack, read: () => null, cells: 100 })).toBe(stack)
  })
})
