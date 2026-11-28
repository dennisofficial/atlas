import { appearanceFrom, EFileIconStyle, type SkillTreeNode } from '@dltech/atlas-client/settings'
import { CardRow, ETextRole, FileTypeIcon, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useSettings } from '../settings/settings-provider'
import { type ESkillFileAction } from './skill-file-actions'
import { SkillFileMenu } from './skill-file-menu'

type TreeProps = {
  nodes: SkillTreeNode[]
  selected: string | null
  readOnly: boolean
  onSelect: (path: string) => void
  onAction: (args: { action: ESkillFileAction; node: SkillTreeNode }) => void
}

export const SkillFileTree = ({ nodes, ...props }: TreeProps) => {
  const colored = appearanceFrom(useSettings().values).fileIcons === EFileIconStyle.Color
  return (
    <>
      {nodes.map((node) => (
        <TreeNode key={node.path} node={node} colored={colored} {...props} />
      ))}
    </>
  )
}

const TreeNode = ({
  node,
  selected,
  readOnly,
  colored,
  onSelect,
  onAction,
}: Omit<TreeProps, 'nodes'> & { node: SkillTreeNode; colored: boolean }) => {
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
          <View style={styles.label}>
            <Text size={ETextRole.Sm}>
              {node.folder ? (expanded ? '▾ ' : '▸ ') : selected === node.path ? '• ' : ''}
            </Text>
            <FileTypeIcon name={node.name} folder={node.folder} open={expanded} colored={colored} />
            <Text size={ETextRole.Sm}>{node.name}</Text>
          </View>
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
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selected={selected}
              readOnly={readOnly}
              colored={colored}
              onSelect={onSelect}
              onAction={onAction}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  name: { flex: 1, minHeight: 32, justifyContent: 'center' },
  label: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  children: { paddingLeft: space(3) },
})
