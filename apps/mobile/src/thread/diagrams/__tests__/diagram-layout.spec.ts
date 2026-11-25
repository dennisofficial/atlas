import { describe, expect, test } from 'bun:test'

import {
  cacheDiagramHeight,
  cachedDiagramHeight,
  clampDiagramHeight,
  clampScale,
  diagramCardKey,
  DIAGRAM_ESTIMATE_HEIGHT,
  DIAGRAM_HEIGHT_CACHE_LIMIT,
  DIAGRAM_MAX_HEIGHT,
  DIAGRAM_MAX_SCALE,
  DIAGRAM_MIN_HEIGHT,
  DIAGRAM_MIN_SCALE,
  EDiagramCardEvent,
  fitDiagramHeight,
  fitScale,
  fitTransform,
  hasMermaidFence,
  initialDiagramCardState,
  minScaleFor,
  diagramCardReducer,
  zoomAbout,
} from '../diagram-layout'

describe('fitDiagramHeight', () => {
  test('scales the rendered height to the card width', () => {
    expect(fitDiagramHeight({ size: { width: 300, height: 150 }, targetWidth: 200 })).toBe(100)
  })

  test('keeps a narrow diagram at its natural height', () => {
    expect(fitDiagramHeight({ size: { width: 120, height: 190 }, targetWidth: 390 })).toBe(190)
  })

  test('falls back to the estimate when a size is missing', () => {
    expect(fitDiagramHeight({ size: { width: 0, height: 150 }, targetWidth: 200 })).toBe(
      DIAGRAM_ESTIMATE_HEIGHT,
    )
    expect(fitDiagramHeight({ size: { width: 300, height: 0 }, targetWidth: 200 })).toBe(
      DIAGRAM_ESTIMATE_HEIGHT,
    )
    expect(fitDiagramHeight({ size: { width: 300, height: 150 }, targetWidth: 0 })).toBe(
      DIAGRAM_ESTIMATE_HEIGHT,
    )
  })
})

describe('clampDiagramHeight', () => {
  test('caps a tall diagram and reports that it is capped', () => {
    expect(clampDiagramHeight(DIAGRAM_MAX_HEIGHT + 40)).toEqual({
      height: DIAGRAM_MAX_HEIGHT,
      clamped: true,
    })
  })

  test('keeps a short diagram and raises an empty one to the minimum', () => {
    expect(clampDiagramHeight(300)).toEqual({ height: 300, clamped: false })
    expect(clampDiagramHeight(10)).toEqual({ height: DIAGRAM_MIN_HEIGHT, clamped: false })
  })
})

describe('diagram height cache', () => {
  test('keys by the trimmed source and the rounded width', () => {
    cacheDiagramHeight({ source: '  graph TD\nA-->B  ', width: 320.4, height: 180 })
    expect(cachedDiagramHeight({ source: 'graph TD\nA-->B', width: 320 })).toBe(180)
    expect(cachedDiagramHeight({ source: 'graph TD\nA-->B', width: 375 })).toBeUndefined()
  })

  test('evicts the oldest entry when it is full', () => {
    const total = DIAGRAM_HEIGHT_CACHE_LIMIT * 2
    for (let index = 0; index < total; index++) {
      cacheDiagramHeight({ source: `diagram-${index}`, width: 320, height: index })
    }
    expect(cachedDiagramHeight({ source: 'diagram-0', width: 320 })).toBeUndefined()
    expect(cachedDiagramHeight({ source: `diagram-${total - 1}`, width: 320 })).toBe(total - 1)
  })
})

describe('fitScale', () => {
  test('fits the whole diagram inside the viewport', () => {
    expect(
      fitScale({ viewport: { width: 390, height: 700 }, content: { width: 780, height: 350 } }),
    ).toBe(0.5)
    expect(
      fitScale({ viewport: { width: 390, height: 700 }, content: { width: 390, height: 7000 } }),
    ).toBe(0.1)
  })

  test('never scales a small diagram up', () => {
    expect(
      fitScale({ viewport: { width: 390, height: 700 }, content: { width: 120, height: 90 } }),
    ).toBe(1)
  })

  test('stays at 1 when a size is missing', () => {
    expect(
      fitScale({ viewport: { width: 390, height: 700 }, content: { width: 0, height: 90 } }),
    ).toBe(1)
    expect(
      fitScale({ viewport: { width: 0, height: 0 }, content: { width: 120, height: 90 } }),
    ).toBe(1)
  })

  test('reserves the hint band before fitting', () => {
    expect(
      fitScale({
        viewport: { width: 390, height: 700 },
        content: { width: 390, height: 1400 },
        inset: 60,
      }),
    ).toBeCloseTo(0.457, 3)
    expect(
      fitScale({
        viewport: { width: 390, height: 100 },
        content: { width: 390, height: 400 },
        inset: 200,
      }),
    ).toBe(1)
  })
})

describe('fitTransform', () => {
  test('centres the diagram in the area above the hint band', () => {
    expect(
      fitTransform({
        viewport: { width: 390, height: 700 },
        content: { width: 780, height: 700 },
        inset: 60,
        interactive: true,
      }),
    ).toEqual({ scale: 0.5, x: 0, y: -30 })
  })

  test('leaves an inline diagram at its natural size', () => {
    expect(
      fitTransform({
        viewport: { width: 272, height: 200 },
        content: { width: 120, height: 90 },
        inset: 60,
        interactive: false,
      }),
    ).toEqual({ scale: 1, x: 0, y: 0 })
  })
})

describe('hasMermaidFence', () => {
  test('finds a mermaid fence anywhere in the message', () => {
    expect(hasMermaidFence('look:\n```mermaid\ngraph TD\nA-->B\n```')).toBe(true)
    expect(hasMermaidFence('~~~Mermaid\ngraph TD\n~~~')).toBe(true)
    expect(hasMermaidFence('hello world')).toBe(false)
    expect(hasMermaidFence('```mermaidx\nA-->B\n```')).toBe(false)
    expect(hasMermaidFence('```ts\nconst a = 1\n```')).toBe(false)
  })
})

describe('minScaleFor', () => {
  test('lets a tall diagram fit fully below the default floor', () => {
    expect(minScaleFor(0.1)).toBe(0.1)
    expect(minScaleFor(1)).toBe(DIAGRAM_MIN_SCALE)
  })
})

describe('clampScale', () => {
  test('keeps the scale between the floor and the ceiling', () => {
    expect(clampScale({ scale: 9, min: 0.4 })).toBe(DIAGRAM_MAX_SCALE)
    expect(clampScale({ scale: 0.1, min: 0.4 })).toBe(0.4)
    expect(clampScale({ scale: 2, min: 0.4 })).toBe(2)
  })
})

describe('zoomAbout', () => {
  test('keeps the pinch midpoint under the fingers', () => {
    expect(
      zoomAbout({
        transform: { scale: 1, x: 0, y: 0 },
        factor: 2,
        focus: { x: 100, y: 0 },
        min: 0.4,
      }),
    ).toEqual({ scale: 2, x: -100, y: 0 })
    expect(
      zoomAbout({
        transform: { scale: 2, x: -100, y: 40 },
        factor: 0.5,
        focus: { x: 0, y: 0 },
        min: 0.4,
      }),
    ).toEqual({ scale: 1, x: -50, y: 20 })
  })

  test('stops at the minimum scale', () => {
    expect(
      zoomAbout({
        transform: { scale: 0.5, x: 10, y: 20 },
        factor: 0.1,
        focus: { x: 5, y: 5 },
        min: 0.4,
      }).scale,
    ).toBe(0.4)
  })
})

describe('diagram card state', () => {
  test('a failed diagram reports the error and drops the measurement', () => {
    const rendered = diagramCardReducer(initialDiagramCardState, {
      type: EDiagramCardEvent.Rendered,
      size: { width: 390, height: 200 },
    })
    expect(rendered).toEqual({ size: { width: 390, height: 200 } })
    const failed = diagramCardReducer(rendered, {
      type: EDiagramCardEvent.Failed,
      message: 'Parse error',
    })
    expect(failed).toEqual({ error: 'Parse error' })
  })

  test('a valid source after an invalid one starts from a clean state', () => {
    const failed = diagramCardReducer(initialDiagramCardState, {
      type: EDiagramCardEvent.Failed,
      message: 'Parse error',
    })
    const recovered = diagramCardReducer(initialDiagramCardState, {
      type: EDiagramCardEvent.Rendered,
      size: { width: 390, height: 180 },
    })
    expect(diagramCardKey('  graph TD\nA--  ')).not.toBe(diagramCardKey('graph TD\nA-->B'))
    expect(failed.error).toBe('Parse error')
    expect(recovered.error).toBeUndefined()
  })
})
