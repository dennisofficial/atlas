import { type AndroidSymbol, type SFSymbol, SymbolView } from 'expo-symbols'

export const Icon = ({
  ios,
  web,
  color,
  size = 20,
}: {
  ios: SFSymbol
  web: AndroidSymbol
  color: string
  size?: number
}) => <SymbolView name={{ ios, web }} size={size} tintColor={color} />
