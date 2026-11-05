export const STAGE_SELECTOR = '[data-slot="preview-stage"]'
export const CLIP_SELECTOR = '[data-preview-clip]'
export const CLIP_COUNT = 4

export type ClipRect = { left: number; top: number; width: number; height: number }

export function clipRectsOf(args: {
  stage: { left: number; top: number; right: number; bottom: number }
  window: { width: number; height: number }
}): ClipRect[] {
  const { stage, window } = args
  const middle = Math.max(0, stage.bottom - stage.top)
  return [
    { left: 0, top: 0, width: window.width, height: Math.max(0, stage.top) },
    {
      left: 0,
      top: stage.bottom,
      width: window.width,
      height: Math.max(0, window.height - stage.bottom),
    },
    { left: 0, top: stage.top, width: Math.max(0, stage.left), height: middle },
    {
      left: stage.right,
      top: stage.top,
      width: Math.max(0, window.width - stage.right),
      height: middle,
    },
  ]
}

export function applyClips(args: { clips: HTMLElement[]; rects: ClipRect[] }): void {
  args.clips.forEach((clip, at) => {
    const rect = args.rects[at]
    if (rect === undefined) return
    Object.assign(clip.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
  })
}
