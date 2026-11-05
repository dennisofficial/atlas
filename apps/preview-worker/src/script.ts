import { ATLAS_WEB_ORIGIN_PATTERNS } from './origins'

export const LOCATION_KIND = 'atlas-preview:location'
export const COMMAND_KIND = 'atlas-preview:command'

const ORIGIN_SOURCES = JSON.stringify(ATLAS_WEB_ORIGIN_PATTERNS.map((pattern) => pattern.source))

export const SCRIPT_SOURCE = `(function () {
  var w = window;
  if (w.parent === w) return;
  var patterns = ${ORIGIN_SOURCES}.map(function (source) { return new RegExp(source); });
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

export const SCRIPT_TAG = `<script>${SCRIPT_SOURCE}</script>`

let hashPromise: Promise<string> | null = null

export function scriptHash(): Promise<string> {
  hashPromise ??= computeHash()
  return hashPromise
}

async function computeHash(): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SCRIPT_SOURCE))
  return `'sha256-${Buffer.from(digest).toString('base64')}'`
}
