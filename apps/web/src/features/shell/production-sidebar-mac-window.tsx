import { useLayoutEffect } from 'react'

import '@/app/desktop.css'

/* Measured on the shipped Mac app: the traffic lights of a hiddenInset window, in page pixels. */
const TRAFFIC_LIGHT = { centerX: 17.75, centerY: 17, diameter: 12, spacing: 23 }

const LIGHT_COLORS = ['#ff5f57', '#febc2e', '#28c840']

function MacTrafficLights() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50">
      {LIGHT_COLORS.map((color, index) => (
        <span
          key={color}
          className="absolute rounded-full ring-[0.5px] ring-black/25"
          style={{
            left:
              TRAFFIC_LIGHT.centerX - TRAFFIC_LIGHT.diameter / 2 + index * TRAFFIC_LIGHT.spacing,
            top: TRAFFIC_LIGHT.centerY - TRAFFIC_LIGHT.diameter / 2,
            width: TRAFFIC_LIGHT.diameter,
            height: TRAFFIC_LIGHT.diameter,
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
