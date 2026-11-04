import type { LucideIcon } from 'lucide-react-native'

export const Icon = ({
  icon: Glyph,
  color,
  size = 16,
}: {
  icon: LucideIcon
  color: string
  size?: number
}) => <Glyph size={size} color={color} strokeWidth={2} />
