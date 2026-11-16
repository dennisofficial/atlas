import { externalUrlOf } from './links.js'

const SEPARATOR = { type: 'separator' }

function joinGroups(groups) {
  const filled = groups.filter((group) => group.length > 0)
  return filled.flatMap((group, index) => (index === 0 ? group : [SEPARATOR, ...group]))
}

function spellingGroup({ params, replaceMisspelling, learnSpelling }) {
  if (!params.isEditable || !params.misspelledWord) return []
  const suggestions = (params.dictionarySuggestions ?? []).map((suggestion) => ({
    label: suggestion,
    click: () => replaceMisspelling(suggestion),
  }))
  return [
    ...suggestions,
    { label: 'Learn Spelling', click: () => learnSpelling(params.misspelledWord) },
  ]
}

function linkGroup({ params, openLink, copyText }) {
  const link = externalUrlOf(params.linkURL)
  if (link === null) return []
  return [
    { label: 'Open Link in Browser', click: () => openLink(link) },
    { label: 'Copy Link', click: () => copyText(link) },
  ]
}

function imageGroup({ params, copyImage, copyText }) {
  if (params.mediaType !== 'image') return []
  const address = externalUrlOf(params.srcURL)
  const copyAddress =
    address === null ? [] : [{ label: 'Copy Image Address', click: () => copyText(address) }]
  return [
    { label: 'Copy Image', click: () => copyImage({ x: params.x, y: params.y }) },
    ...copyAddress,
  ]
}

function editGroup({ params }) {
  const flags = params.editFlags ?? {}
  if (params.isEditable) {
    return [
      { role: 'undo', enabled: Boolean(flags.canUndo) },
      { role: 'redo', enabled: Boolean(flags.canRedo) },
      SEPARATOR,
      { role: 'cut', enabled: Boolean(flags.canCut) },
      { role: 'copy', enabled: Boolean(flags.canCopy) },
      { role: 'paste', enabled: Boolean(flags.canPaste) },
      { role: 'selectAll', enabled: Boolean(flags.canSelectAll) },
    ]
  }
  if (params.selectionText) return [{ role: 'copy' }]
  return []
}

export function contextMenuTemplate({
  params,
  openLink,
  copyText,
  copyImage,
  replaceMisspelling,
  learnSpelling,
}) {
  return joinGroups([
    spellingGroup({ params, replaceMisspelling, learnSpelling }),
    linkGroup({ params, openLink, copyText }),
    imageGroup({ params, copyImage, copyText }),
    editGroup({ params }),
  ])
}
