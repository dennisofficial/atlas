import { mcpHueOf } from '@dltech/atlas-client/transcript'
import { EFontWeight, ETextRole, Text, useIsDark } from '@dltech/atlas-ui-native'
import { StyleSheet, View } from 'react-native'

/**
 * The letter tile an MCP call wears where a tool's icon would be.
 *
 * The hue comes from the server's name, so `Paper` is the same colour in every thread; lightness and
 * saturation are fixed so a column of them still reads as one family. Light and dark each get their
 * own pair, the way the web's `oklch` pair does.
 */
export const McpServerMark = ({ server }: { server: string }) => {
  const dark = useIsDark()
  const hue = mcpHueOf(server)
  const letter = server.trim().charAt(0).toUpperCase() || '?'
  const background = dark ? `hsl(${hue}, 26%, 26%)` : `hsl(${hue}, 62%, 92%)`
  const color = dark ? `hsl(${hue}, 58%, 78%)` : `hsl(${hue}, 58%, 34%)`

  return (
    <View style={[styles.mark, { backgroundColor: background }]}>
      <Text size={ETextRole.Xs} weight={EFontWeight.Medium} color={color} style={styles.letter}>
        {letter}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    borderRadius: 3,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  letter: {
    fontSize: 10,
    lineHeight: 12,
  },
})
