# iOS Home Screen web app: safe areas and the top edge

Research date: 2026-11-15. Scope: a Home Screen web app on iOS 26/27 as `apps/web` meets it — the page sitting under the status bar and the home indicator, `env(safe-area-inset-*)`, and WebKit's top colour extension versus the scroll edge blur. No device reproduction performed; WebKit paths are from `github.com/WebKit/WebKit@main` fetched on that date and line numbers may drift. Everything marked **(inference)** is a reading of the cited source, not a documented statement.

## Finding

On iOS 26/27 a site added to the Home Screen opens as a web app with no Safari chrome: "there is no browser URL text field at the top of the screen or button bar at the bottom of the screen. Only a status bar appears at the top" ([Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)). Since Safari 26 the default is that "every website added to the Home Screen opens as a web app" ([WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [Safari 26.0 release notes](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes) 113034903), so this is no longer contingent on a manifest.

**Atlas web now owns the whole screen and insets its own surfaces.** The app sets `viewport-fit=cover` together with `apple-mobile-web-app-status-bar-style: black-translucent` — the documented pair under which "the web content is displayed on the entire screen, partially obscured by the status bar" ([Safari HTML Reference](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html)). Insets are exposed once as CSS variables in `packages/ui/src/styles/base.css`:

```css
--safe-area-top: env(safe-area-inset-top, 0px);
--safe-area-right: env(safe-area-inset-right, 0px);
--safe-area-left: env(safe-area-inset-left, 0px);
--safe-area-bottom: env(safe-area-inset-bottom, 0px);
```

The top, left and right edges are safe areas in the WebKit sense. Without `cover`, WebKit only ever avoided the top, left and right safe areas (`_obscuredInsetEdgesAffectedBySafeArea = UIRectEdgeTop | UIRectEdgeLeft | UIRectEdgeRight`, `Source/WebKit/UIProcess/API/Cocoa/WKWebView.mm:675`), so content already ran under the home indicator; `cover` plus these three insets reproduces the old geometry with the page painting the status band itself.

The bottom edge is handled the other way: surfaces still paint to the screen edge, and the bottom-anchored content inside them — composer docks and sheet bodies — pads itself by `--safe-area-bottom` (with its ordinary padding as the floor, `pb-[max(1rem,var(--safe-area-bottom))]`), so nothing overlaps the home indicator while the surface behind it reaches the glass.

| Surface                                    | Owner                                                                                                            | Treatment                                                                                                                                                                                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App layout                                 | `packages/ui/src/components/sidebar.tsx` (`SidebarProvider`)                                                     | the wrapper pads top, right and left, so every sidebar-layout page (app shell, settings) inherits the inset; `SidebarInset` is `h-full` of that padded box                                            |
| Fixed desktop sidebar                      | `packages/ui/src/components/sidebar.tsx` (`sidebar-container`, `sidebar-inner`)                                  | the container still runs the full height and offsets by the side insets; `sidebar-inner` pads the top, so the sidebar surface fills the status band beside the main column                            |
| Sheet edges                                | `packages/ui/src/components/sheet.tsx` (`SheetContent` per `side`)                                               | top, left and right edges start inside the inset; the bottom edge stays at 0 and the body pads `--safe-area-bottom`, so the sheet surface reaches the glass and its content clears the home indicator |
| Composer docks                             | `apps/web/src/features/sessions/session-view.tsx`, `apps/web/src/features/threads/composer-footer.tsx`           | the bottom padding is `max(its usual padding, --safe-area-bottom)`, so the composer sits above the home indicator and the panel behind it still reaches the edge                                      |
| Full-page roots without the sidebar layout | `apps/web/src/features/auth/auth-shell.tsx`, `apps/web/src/features/project-settings/project-settings-shell.tsx` | the auth shell pads itself; the project settings header grows by the top inset and pads it, the root pads the sides                                                                                   |

`env(safe-area-inset-*)` is 0 on desktop browsers and in the Mac app, so all of this is a no-op there — that is also why the variables carry a `0px` fallback rather than needing a media query.

Nothing changes layout outside a device with a non-zero inset.

### The landscape band under a standalone web app

In a standalone Home Screen web app, open landscape on the iPhone Duo, an empty band sits below the app's bottom edge: WebKit lays out the `position: fixed; inset: 0` box (and `100svh`) shorter than the physical screen, and the remainder of the screen is not painted by the page at all ([WebKit bug 323403](https://bugs.webkit.org/show_bug.cgi?id=323403)). CSS cannot fill it — the band is outside the layout viewport, so no padding, background or fixed element reaches it. Atlas records it rather than working around it; the fix is WebKit's.

Measured on the iPhone Duo (iOS 27.1) on 2026-11-24 with a temporary probe page, in CSS px:

| Posture            | Screen    | `innerHeight` | `100svh` / `100dvh` / `inset: 0` | Painted    | Insets t r b l |
| ------------------ | --------- | ------------- | -------------------------------- | ---------- | -------------- |
| Unfolded portrait  | 669 × 951 | 869 or 951    | 869                              | 0–869      | 82 0 34 0      |
| Unfolded landscape | 951 × 669 | 669 or 587    | 669 or 587                       | 0–867 wide | 0 0 34 0       |
| Folded portrait    | 466 × 678 | 678           | 678                              | 0–382 wide | 0 0 34 0       |
- The web view is the screen minus the status bar in both axes, anchored top-left. When the status bar is a right column the strip falls under it; when it is on top the strip falls at the bottom, under the composer.
- Even when `innerHeight`, `100lvh` and `100vh` report 951, nothing paints below 869, so a taller CSS height only pushes content into the dead strip. `h-svh` is the correct shell height.
- `window.screen` reports the folded 466 × 678 when unfolded.
- `apple-mobile-web-app-status-bar-style: default` (tried in #2764, rolled back) changed nothing: the page still drew under the status bar with an 82 px top inset.

## Why

Three symptoms on the iPhone Duo, and what each traces to.
1. **A status band stacked above our bar.** Without `cover` the layout viewport already avoids the unsafe area, so the shell's `h-svh` column started below the status bar and our own bar below that — two bands with no shared background. With `cover` the page paints that strip and our bar's background is what shows through it.
2. **The iOS 26 scroll edge blur over our top bar.** Apple's scroll edge effect is "blur transitions between scrolling content and an area with controls, such as toolbars" ([`ScrollEdgeEffectStyle`](https://developer.apple.com/documentation/swiftui/scrolledgeeffectstyle), iOS 26.0+). Without `cover`, WebKit sets the scroll view's content-inset adjustment to `Always` (`WKWebViewIOS.mm:3964`), so the status bar becomes a top content inset and UIKit draws the effect over it, fading into the first points of the page — our bar. With `cover` the adjustment is `Never` and the page paints the band itself **(inference: where UIKit places the effect is not in WebKit's source)**. WebKit can also swap the blur for flat colour when a fixed/sticky box qualifies (below); Atlas's bars are normal flow, so that path does not apply.
3. **Flaky taps on the toggles right under the status bar.** Not documented for web apps. Candidates **(inference)**: the status bar's tap-to-scroll-to-top region reaching into the top of our bar, or the inset strip and its edge effect intercepting touches at the top of the page. WebKit's `WKColorExtensionView` does swallow taps in its strip (§ below), but it only exists for a fixed/sticky top edge, which our bars are not. Whether `cover` settles the taps has to be checked on the device.

## Evidence

### Apple's status-bar-style contract

"If `content` is set to `default`, the status bar appears normal. If set to `black`, the status bar has a black background. If set to `black-translucent`, the status bar is black and translucent. If set to `default` or `black`, the web content is displayed below the status bar. If set to `black-translucent`, the web content is displayed on the entire screen, partially obscured by the status bar." ([Safari HTML Reference — Apple-Specific Meta Tag Keys](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html)). No effect outside standalone/full-screen mode, and none of the iOS 26 release notes change it; the archived reference is the last documented statement of the behaviour.

### `viewport-fit` and `env()`

`viewport-fit: cover` makes the layout viewport "the circumscribed rectangle of the physical screen" instead of the largest inscribed one ([CSS Round Display §4.1](https://drafts.csswg.org/css-round-display-1/#viewport-fit-property)). The four `safe-area-inset-*` variables "define a rectangle by its top, right, bottom, and left insets from the edge of the viewport", with the requirement that on rectangular displays "these must all be zero" ([CSS Env §2.1](https://drafts.csswg.org/css-env-1/#safe-area-insets)) — Apple mapping them onto system UI is an implementation extension, not spec. They are dynamic (`safe-area-max-inset-*` are their static maximums, [§2.2](https://drafts.csswg.org/css-env-1/#safe-area-max-insets)) and substituted per document with an optional fallback, `env(name, fallback)`.

### What `env(safe-area-inset-top)` computes

`WKWebViewIOS.mm:893-913`, `-_computedUnobscuredSafeAreaInset`:

```objc
if (_haveSetUnobscuredSafeAreaInsets) return _unobscuredSafeAreaInsets;   // explicit override
if (!self._safeAreaShouldAffectObscuredInsets) {                          // == viewport-fit: cover
    auto i = self.safeAreaInsets;
    if (_haveSetObscuredInsets) { i.top = max(0, i.top - _obscuredInsets.top); /* …left/bottom/right */ }
    return i;
}
return UIEdgeInsetsZero;                                                  // not cover
```

`_safeAreaShouldAffectObscuredInsets` is `_avoidsUnsafeArea` (`WKWebViewIOS.mm:4792-4797`), fed from `ViewportConfiguration::avoidsUnsafeArea = (viewportFit != ViewportFit::Cover)` (`Source/WebCore/page/ViewportConfiguration.cpp:577`). So **without `cover` the insets are 0**; **with `cover` they are the device safe area minus whatever obscured insets the host set**. `env()` maps only to these, in `EnvironmentVariables::updateSafeAreaInsetVariables` (`Source/WebCore/style/StyleEnvironmentVariables.cpp:178-186`). The consequences for us: a top obscured inset of 0 means `env(safe-area-inset-top)` is the full status-bar height (what we want), while a host-set inset equal to the status bar gives 0 (see open questions).

### Colour extension versus scroll edge blur

WebKit decides per edge in two stages. In the web process, `Page::updateFixedContainerEdges` samples the edges of the fixed-position layout rect and yields a `FixedContainerEdges` value (`Source/WebCore/platform/FixedContainerEdges.h:34-44`); in the UI process, `WKWebView._updateFixedColorExtensionViews` (`WKWebView.mm:3618-3700`) installs a flat `WKColorExtensionView` over the inset strip when the edge has a visible colour and the inset is non-zero, and `_shouldHideTopScrollPocket` (`Source/WebKit/UIProcess/API/ios/WKWebViewIOS.mm:2504-2516`) then hides the soft blur on iPhone. Without both, the UIKit blur stays.

The gate that matters for a page is `containerEdgeCandidateResult` (`Source/WebCore/page/LocalFrameView.cpp:2475-2530`) plus `findFixedContainer` (2536-2648):
- `renderer.isFixedPositioned() || renderer.isStickilyPositioned()` (2494-2495) — fixed **or** sticky; a normal-flow bar never qualifies, and "currently stuck" is not part of the test.
- the box must be ≥ **0.9 ×** the viewport on that side (ratios 0.9/1.05, 2425-2440), not nearly transparent (`opacity < 0.1`), and not larger than 1.05 × the viewport.
- it must paint at the sample point: the midpoint of the contracted edge, i.e. `(viewportCentreX, viewportTop + 4)` for the top (`fixedContainerSampleRectMargin = 4`, `PageColorSampler.h:41-42`).
- a visible background colour (`primaryBackgroundColorForRenderer`, 2457-2473); otherwise the 2 px snapshot must be > 67 % one colour across 29 sample points (`PageColorSampler.cpp:358-425`), else `Multiple` and the blur survives.
- the top edge is only sampled at all when `insets.top() > 0` (`Source/WebKit/WebProcess/WebPage/Cocoa/WebPageCocoa.mm:1786-1787`) — no host inset, no strip, no extension.
- top sampling locks after the user scrolled: `Page::canSampleTopFixedContainerEdge()` (`Page.cpp:5804-5816`) allows it while parsing or when `topContentInsetBackgroundCanChangeAfterScrolling` is set, and `updateFixedContainerEdges` then drops `BoxSide::Top` (`Page.cpp:5836-5839`). So the colour is taken from the state before interaction.

The mechanism is generic WebKit, not Safari UI: `ContentInsetBackgroundFillEnabled` defaults to `isLiquidGlassEnabled()` (`Source/WebKit/Shared/Cocoa/WebPreferencesDefaultValuesCocoa.mm:187-194`), i.e. on for iOS 26 in every embedder.

### `WKColorExtensionView` participates in hit testing

`Source/WebKit/UIProcess/Cocoa/WKColorExtensionView.h:48` subclasses `CocoaView`/`UIView`; the implementation (`WKColorExtensionView.mm:25-150`) overrides no `hitTest:withEvent:` and nothing sets `userInteractionEnabled = NO`. It is inserted above the content view (`insertSubview:extensionView aboveSubview:_contentView`, `WKWebView.mm:3631`) with the strip's exact frame (`WKWebView.mm:3713-3721`). **(inference, from geometry and the absent override rather than measurement):** a tap in that strip lands on this view, which has no gesture recognisers and does not forward to the page, so content painted underneath is not tappable while the fill is up. It only exists when a fixed/sticky box qualifies, so it is not in play for Atlas's normal-flow bars. `UIScrollEdgeEffect` hit testing is not answerable here — UIKit creates the effect and WebKit only wraps it (`Source/WebKit/UIProcess/ios/WKScrollView.mm:627-720`).

### iPhone Duo, as far as Apple published it

Safari 27.1 ships with it, "the same WebKit engine and the same web technologies as every other iPhone"; two displays, tab bar at the top on the inner display like iPad or Mac; the web viewport is **382–951 × 368–902** CSS px ([WebKit Features for Safari 27.1](https://webkit.org/blog/18486/webkit-features-for-safari-27-1/)). `device-posture` / `navigator.devicePosture` and the viewport-segment media queries are a developer preview behind Settings → Apps → Safari → Advanced → Feature Flags. There are **no published safe-area or status-bar numbers**, and the post explicitly warns against device sniffing. It also says content does not yet extend behind the side controls — Safari extends the page background there instead — so on the Duo the area beside side controls is not ours to own.

## Open questions, to settle on device

1. **Does the Home Screen web-app host set obscured insets?** That host is not in WebKit. If it sets a top inset equal to the status-bar band, `_computedUnobscuredSafeAreaInset` subtracts it and `env(safe-area-inset-top)` is 0 under `cover`; the scroll inset should still start the document below the band, but the band is then WebKit's strip rather than our padding. If it sets 0, the padding fills the band. **(inference either way.)**
2. **`black-translucent` and white status-bar text.** The reference says the bar is "black and translucent", which reads as forced light glyphs; in the light theme that would be invisible on our background. Not documented for iOS 26/27.
3. **Landscape side insets on the Duo.** `env(safe-area-inset-left|right)` should be non-zero where the side controls sit, and the top and bottom insets should span the status bar and the home indicator, but no Apple numbers exist — check the values rather than assuming 0. The bottom inset reaches the composer docks and sheets through `--safe-area-bottom`.
4. **How to inspect.** Safari → Develop → the device → the Home Screen web app, then read `getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top')` (and `-left`/`-right`/`-bottom`); the raw `env()` values are one level behind the variable, and `innerHeight`/`visualViewport.height` give the rest. In a desktop browser, override `--safe-area-top: 62px` (and the others, including `--safe-area-bottom: 34px`) on `:root` to preview a phone inset without a device.
5. **Whether the top edge is actually ours.** If the extension mechanism is on (it is, with Liquid Glass) and the host inset is non-zero, the strip is a system-painted flat fill, not our bar; the visible result should still be seamless, but the colour comes from the sampled bar, so a translucent top bar yields `Multiple` and the blur stays.
