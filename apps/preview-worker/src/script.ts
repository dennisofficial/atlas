import { atlasWebOriginPatternsOf, DEFAULT_PREVIEW_DOMAIN } from './origins'

export const LOCATION_KIND = 'atlas-preview:location'
export const LOADING_KIND = 'atlas-preview:loading'
export const COMMAND_KIND = 'atlas-preview:command'

const sources = new Map<string, string>()

export function scriptSourceOf(domain: string): string {
  const held = sources.get(domain)
  if (held !== undefined) return held
  const source = buildSource(domain)
  sources.set(domain, source)
  return source
}

function buildSource(domain: string): string {
  const origins = JSON.stringify(atlasWebOriginPatternsOf(domain).map((pattern) => pattern.source))
  return `(function () {
  var w = window;
  if (w.parent === w) return;
  var patterns = ${origins}.map(function (source) { return new RegExp(source); });
  var last = '';
  function report() {
    var url = w.location.href;
    var title = w.document.title;
    var key = url + '\\n' + title;
    if (key === last) return;
    last = key;
    w.parent.postMessage({ kind: '${LOCATION_KIND}', url: url, title: title }, '*');
  }
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = w.history[name];
    w.history[name] = function () {
      var result = original.apply(this, arguments);
      report();
      return result;
    };
  });
  w.addEventListener('load', report);
  w.addEventListener('DOMContentLoaded', report);
  w.addEventListener('popstate', report);
  w.addEventListener('hashchange', report);
  w.addEventListener('beforeunload', function () {
    w.parent.postMessage({ kind: '${LOADING_KIND}' }, '*');
  });
  var head = w.document.head;
  if (head && w.MutationObserver) {
    new w.MutationObserver(report).observe(head, { childList: true, subtree: true, characterData: true });
  }
  w.addEventListener('message', function (event) {
    if (event.source !== w.parent) return;
    if (!patterns.some(function (pattern) { return pattern.test(event.origin); })) return;
    var data = event.data;
    if (!data || data.kind !== '${COMMAND_KIND}') return;
    if (data.command === 'back') w.history.back();
    else if (data.command === 'forward') w.history.forward();
    else if (data.command === 'reload') w.location.reload();
  });
})();`
}

export const SCRIPT_SOURCE = scriptSourceOf(DEFAULT_PREVIEW_DOMAIN)

export const scriptTagOf = (domain: string): string => `<script>${scriptSourceOf(domain)}</script>`

export const SCRIPT_TAG = scriptTagOf(DEFAULT_PREVIEW_DOMAIN)

const hashes = new Map<string, Promise<string>>()

export function scriptHashOf(domain: string): Promise<string> {
  const held = hashes.get(domain)
  if (held !== undefined) return held
  const computed = computeHash(domain)
  hashes.set(domain, computed)
  return computed
}

export const scriptHash = (): Promise<string> => scriptHashOf(DEFAULT_PREVIEW_DOMAIN)

async function computeHash(domain: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(scriptSourceOf(domain)),
  )
  return `'sha256-${Buffer.from(digest).toString('base64')}'`
}
