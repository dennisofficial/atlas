export type SkillTreeNode = {
  name: string
  path: string
  folder: boolean
  children: SkillTreeNode[]
}

export function buildSkillTree(paths: string[]): SkillTreeNode[] {
  const root: SkillTreeNode[] = []
  for (const filePath of paths) {
    const segments = filePath.split('/')
    let siblings = root
    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join('/')
      const folder = index < segments.length - 1
      let node = siblings.find((candidate) => candidate.path === path)
      if (!node) {
        node = { name: segment, path, folder, children: [] }
        siblings.push(node)
      }
      siblings = node.children
    })
  }
  return sortSkillTree(root)
}

function sortSkillTree(nodes: SkillTreeNode[]): SkillTreeNode[] {
  return nodes
    .map((node) => ({ ...node, children: sortSkillTree(node.children) }))
    .sort((a, b) => {
      if (a.folder !== b.folder) return a.folder ? -1 : 1
      if (!a.folder && a.name === 'SKILL.md') return -1
      if (!b.folder && b.name === 'SKILL.md') return 1
      return a.name.localeCompare(b.name)
    })
}
