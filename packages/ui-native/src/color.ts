const HEX = /^#([0-9a-f]{6})$/i

export const withAlpha = ({ color, alpha }: { color: string; alpha: number }): string => {
  const match = HEX.exec(color)
  if (match === null) return color
  const channel = Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
  return `#${match[1]}${channel.toString(16).padStart(2, '0')}`
}
