function clamp({ value, min, max }) {
  return Math.min(Math.max(value, min), Math.max(max, min))
}

// Electron places a child view from the top-left of the window's contentView, the same origin the
// desktop UI states `rect` in, so the contract rect only needs rounding to integer bounds and
// clamping to the content size.
export function paneBounds({ rect, contentSize }) {
  const x = clamp({ value: Math.round(rect.x), min: 0, max: contentSize.width })
  const y = clamp({ value: Math.round(rect.y), min: 0, max: contentSize.height })
  return {
    x,
    y,
    width: clamp({ value: Math.round(rect.width), min: 0, max: contentSize.width - x }),
    height: clamp({ value: Math.round(rect.height), min: 0, max: contentSize.height - y }),
  }
}
