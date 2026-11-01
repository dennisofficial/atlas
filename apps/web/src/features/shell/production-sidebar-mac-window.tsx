import { useLayoutEffect } from 'react'

import '@/app/desktop.css'

export const MAC_TRAFFIC_LIGHT_OFFSET = { x: 8, y: 8 }

const NATIVE_CLOSE_BUTTON_ORIGIN = { x: 7, top: 6 }
const NATIVE_BUTTON_FRAME = { width: 14, height: 16 }
const NATIVE_BUTTON_SPACING = 20
const LIGHT_DIAMETER = 12
const LIGHT_COLORS = ['#ff5f57', '#febc2e', '#28c840']

function MacTrafficLights() {
  const frameLeft = NATIVE_CLOSE_BUTTON_ORIGIN.x + MAC_TRAFFIC_LIGHT_OFFSET.x
  const frameTop = NATIVE_CLOSE_BUTTON_ORIGIN.top + MAC_TRAFFIC_LIGHT_OFFSET.y
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50">
      {LIGHT_COLORS.map((color, index) => (
        <span
          key={color}
          className="absolute rounded-full ring-[0.5px] ring-black/25"
          style={{
            left:
              frameLeft +
              index * NATIVE_BUTTON_SPACING +
              (NATIVE_BUTTON_FRAME.width - LIGHT_DIAMETER) / 2,
            top: frameTop + (NATIVE_BUTTON_FRAME.height - LIGHT_DIAMETER) / 2,
            width: LIGHT_DIAMETER,
            height: LIGHT_DIAMETER,
            background: color,
          }}
        />
      ))}
    </div>
  )
}

export function MacWindowSimulation({ fullscreen }: { fullscreen: boolean }) {
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.desktop = ''
    root.toggleAttribute('data-fullscreen', fullscreen)
    return () => {
      delete root.dataset.desktop
      root.removeAttribute('data-fullscreen')
    }
  }, [fullscreen])
  return fullscreen ? null : <MacTrafficLights />
}
