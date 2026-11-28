import type { SkillTreeNode } from '@dltech/atlas-client/settings'
import { CardRow, ETextRole, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { type ESkillFileAction } from './skill-file-actions'
import { SkillFileMenu } from './skill-file-menu'

type TreeProps = {
  nodes: SkillTreeNode[]
  selected: string | null
  readOnly: boolean
  onSelect: (path: string) => void
  onAction: (args: { action: ESkillFileAction; node: SkillTreeNode }) => void
}

export const SkillFileTree = ({ nodes, ...props }: TreeProps) => (
  <>
    {nodes.map((node) => (
      <TreeNode key={node.path} node={node} {...props} />
    ))}
  </>
)

const TreeNode = ({
  node,
  selected,
  readOnly,
  onSelect,
  onAction,
}: Omit<TreeProps, 'nodes'> & { node: SkillTreeNode }) => {
  const [expanded, setExpanded] = useState(true)
  const handlePress = () => (node.folder ? setExpanded(!expanded) : onSelect(node.path))
  return (
    <View>
      <CardRow>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={node.path}
          accessibilityState={{
            expanded: node.folder ? expanded : undefined,
            selected: selected === node.path,
          }}
          onPress={handlePress}
          style={styles.name}
        >
          <Text size={ETextRole.Sm}>
            {node.folder ? (expanded ? '▾ ' : '▸ ') : selected === node.path ? '• ' : ''}
            {node.name}
          </Text>
        </Pressable>
        {readOnly ? null : (
          <SkillFileMenu
            path={node.path}
            folder={node.folder}
            onAction={(action) => onAction({ action, node })}
          />
        )}
      </CardRow>
      {expanded && node.folder ? (
        <View style={styles.children}>
          <SkillFileTree
            nodes={node.children}
            selected={selected}
            readOnly={readOnly}
            onSelect={onSelect}
            onAction={onAction}
          />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  name: { flex: 1, minHeight: 32, justifyContent: 'center' },
  children: { paddingLeft: space(3) },
})
