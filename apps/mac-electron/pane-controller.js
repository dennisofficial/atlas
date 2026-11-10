import { paneBounds } from './pane-geometry.js'

export function createPaneController({ contentView, createView, contentSize, log = () => {} }) {
  let view = null
  let visible = false
  let obscured = false
  let rect = null
  let size = contentSize
  let url = null

  const contents = () => (view === null ? null : view.webContents)

  const ensureView = () => {
    if (view !== null) return view
    view = createView()
    contentView.addChildView(view)
    log('pane: browser view created')
    return view
  }

  const layout = () => {
    if (view === null || rect === null) return
    view.setBounds(paneBounds({ rect, contentSize: size }))
  }

  const reflect = () => {
    if (view !== null) view.setVisible(visible && !obscured)
  }

  const load = (next) => {
    url = next
    contents()
      ?.loadURL(next)
      .catch((error) => log(`pane: ${next} did not load: ${error.message}`))
  }

  const show = ({ url: nextUrl, rect: nextRect }) => {
    ensureView()
    rect = nextRect
    visible = true
    if (url !== nextUrl) load(nextUrl)
    layout()
    reflect()
  }

  const navigate = (nextUrl) => {
    if (view === null) return { ok: false, error: 'no pane to navigate' }
    load(nextUrl)
    return { ok: true }
  }

  const perform = (verb) => {
    const webContents = contents()
    if (webContents === null) return { ok: false, error: `no pane to ${verb}` }
    switch (verb) {
      case 'back':
        if (webContents.navigationHistory.canGoBack()) webContents.navigationHistory.goBack()
        return { ok: true }
      case 'forward':
        if (webContents.navigationHistory.canGoForward()) webContents.navigationHistory.goForward()
        return { ok: true }
      case 'reload':
        webContents.reload()
        return { ok: true }
      default:
        webContents.stop()
        return { ok: true }
    }
  }

  const apply = (command) => {
    switch (command.kind) {
      case 'show':
        show(command)
        return { ok: true }
      case 'hide':
        visible = false
        reflect()
        return { ok: true }
      case 'setRect':
        rect = command.rect
        layout()
        return { ok: true }
      case 'navigate':
        return navigate(command.url)
      case 'setObscured':
        obscured = command.obscured
        reflect()
        return { ok: true }
      case 'back':
      case 'forward':
      case 'reload':
      case 'stop':
        return perform(command.kind)
      default:
        return { ok: false, error: `unknown command ${command.kind}` }
    }
  }

  const setContentSize = (next) => {
    size = next
    layout()
  }

  const destroy = () => {
    if (view === null) return
    contentView.removeChildView(view)
    view.webContents.close()
    view = null
  }

  return { apply, setContentSize, destroy }
}
