import { startHost } from './host-process.js'

export function createHostLauncher({ trust, apns, script, bun, environmentOf, log = () => {} }) {
  return (webRoot) => {
    const started = startHost({ script, bun, environment: environmentOf(webRoot) })
    const page = started.host.then((host) => {
      trust(host.fingerprint)
      apns.attach(host.httpOrigin)
      return host
    })
    page.catch(log)
    return { ...started, page }
  }
}
