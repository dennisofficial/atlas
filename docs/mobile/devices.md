# Mobile check devices

Every mobile live check uses the viewports in this file. A viewport is a CSS viewport in the Expo
web bundle, which equals points: React Native Web maps one density-independent pixel to one CSS
pixel.

## Sources

- Device pixels and ppi: [iPhone 18 Pro specs](https://www.apple.com/iphone-18-pro/specs/),
  [iPhone Duo specs](https://www.apple.com/iphone-duo/specs/).
- Logical width, height and scale factor: [ios-resolution.com iPhone Duo
  (Inner)](https://www.ios-resolution.com/iphone-duo-inner/), [(Outer)](https://www.ios-resolution.com/iphone-duo-outer/),
  [iPhone 18 Pro Max](https://www.ios-resolution.com/iphone-18-pro-max/).
- Foldable design guidance: [HIG: Designing for iPhone
  Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo),
  [HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout).
- Foldable layout APIs: [UIView.ReservedRegion](https://developer.apple.com/documentation/uikit/uiview/reservedregion),
  [UIArrangementViewController](https://developer.apple.com/documentation/uikit/uiarrangementviewcontroller),
  [UIHingeInteraction](https://developer.apple.com/documentation/uikit/uihingeinteraction).
- Hinge in React Native: [Expo Hinge](https://docs.expo.dev/versions/latest/sdk/hinge/),
  [onHingeChange](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/modifiers/#onhingechangehandler).

## Check viewports

`Source` is `spec` when Apple publishes the pixel size and ios-resolution.com publishes the scale
factor, and `est` when the value is an estimate. Each estimate states its reason.

| Device        | Posture          | Viewport | DPR | Safe-area insets     | Size class        | Source    |
| ------------- | ---------------- | -------- | --- | -------------------- | ----------------- | --------- |
| iPhone 18 Pro | portrait         | 440×956  | 3   | top 62, bottom 34    | compact / regular | spec, est |
| Max           | landscape        | 956×440  | 3   | sides 62, bottom 21  | regular / compact | spec, est |
| iPhone Duo    | closed           | 466×678  | 3   | top 62, bottom 34    | compact width     | spec, est |
|               | closed landscape | 678×466  | 3   | sides 62, bottom 21  | compact width     | spec, est |
|               | open portrait    | 626×890  | 3   | top ~78, bottom 34   | compact width     | spec, est |
|               | open landscape   | 890×626  | 3   | right ~80, bottom 21 | regular width     | spec, est |

The sizes come out exactly:
- iPhone 18 Pro Max: 1320×2868 px at scale 3 → 440×956 pt.
- iPhone Duo outer display: 1398×2034 px at scale 3 → 466×678 pt.
- iPhone Duo inner display: 1878×2670 px at scale 3 → 626×890 pt. The inner display is wider than
  tall when the device lies open (164.6 mm × 117.8 mm), so 890×626 is the open landscape viewport
  and 626×890 is the same display rotated a quarter turn.

What is not published, and what to do about it:
- **Safe-area insets.** Apple publishes no inset values for either device. The numbers above are
  estimates. The 62 and 34 values are the insets of the iPhone 16 and 17 Pro Max, which share the
  440×956 logical size and a Dynamic Island. The 21 is the landscape home-indicator inset on that
  family. The Duo values assume the same status bar and home indicator, which the HIG does not
  confirm: it says controls move to the side on the outer display and on the inner display in
  landscape, so the side inset is the one that matters there. Read the real values instead of
  trusting these: `useSafeAreaInsets()` in the app, or the Simulator's view debugger. Record them
  in this table when you do.
- **Fold and status strip.** The fold is dead center (a hamburger fold) and the crease is
  invisible, so no band needs to be kept clear. When open, the Duo reserves a status strip for
  the time and the status icons: at the top in open portrait, on the right in open landscape. The
  ~78 and ~80 pt values are measured from Dennis's screenshots of the web app on the device, not
  published. A web app leaves the strip blank. Native tabs (`expo-router/native-tabs`) fill it with
  the tab bar, so the app uses native tabs and draws nothing of its own there.
- **Size classes.** The HIG states that the outer display uses a compact width layout and the
  inner display a regular width layout. The vertical classes are not published. The open portrait
  entry is an estimate: 626 pt is narrower than the width at which iPhone switches to regular, and
  the HIG calls the inner display in portrait the case that keeps standard horizontal bars.

## How to set a viewport

`agent-browser set viewport <w> <h> [scale]` sets the CSS viewport and the device scale factor.
The value holds across later navigations, so set it before you open the app.

```sh
# iPhone 18 Pro Max, portrait
agent-browser set viewport 440 956 3
# iPhone 18 Pro Max, landscape
agent-browser set viewport 956 440 3
# iPhone Duo, closed
agent-browser set viewport 466 678 3
# iPhone Duo, closed landscape
agent-browser set viewport 678 466 3
# iPhone Duo, open portrait
agent-browser set viewport 626 890 3
# iPhone Duo, open landscape
agent-browser set viewport 890 626 3
```

Then open the app and take a screenshot:

```sh
agent-browser set viewport 890 626 3
agent-browser open "$MOBILE_URL"
agent-browser screenshot duo-open-landscape.png
```

`agent-browser set device "<name>"` also exists, but its device list has no iPhone 18 Pro Max or
iPhone Duo entry, so use `set viewport` with the third argument for the scale factor.

What the web bundle cannot prove:
- `expo-hinge` has no web implementation, so `useHinge()` returns `null` in the browser
  (`expo-hinge/build/ExpoHinge.js:3` uses `requireOptionalNativeModule`, and its module config
  lists only apple and android). Fold-aware behaviour only runs on a device or the Simulator.
- The browser reports no safe-area insets, so insets are always 0 on the web check.
- The third `set viewport` argument changes the raster only. Layout responds to the CSS size.

## Design rules for the Duo

- Design for the space, not the device. Use size classes: compact width on the outer display,
  regular width on the inner display.
  ([HIG Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo))
- Build the app to resize. Avoid fixed widths and anything tied to one display. Use size classes,
  layout margins and safe-area insets.
  ([HIG Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo))
- Keep function and state the same on both displays. Add one level of hierarchy on the inner
  display when the content supports it: a list of sessions alone when closed, list and transcript
  side by side when open.
  ([HIG Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo))
- Do not use hinge updates for layout. Hinge updates are input for effects, animations and games.
  Layout follows size classes, safe areas and reserved regions.
  ([UIHingeInteraction](https://developer.apple.com/documentation/uikit/uihingeinteraction),
  [Expo Hinge](https://docs.expo.dev/versions/latest/sdk/hinge/))
- Use the status strip. On the open Duo the system reserves a strip for the status bar (top in
  portrait, right in landscape). Native tabs put the tab bar there; a custom layout leaves it
  blank. The fold itself is invisible and needs no clearance.
  ([UIView.ReservedRegion](https://developer.apple.com/documentation/uikit/uiview/reservedregion))
- Split along the long axis of the space: side by side when the view is wider than tall, stacked
  when it is taller than wide. Apple's split arrangement and split views do this automatically.
  ([HIG Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo),
  [UIArrangementViewController](https://developer.apple.com/documentation/uikit/uiarrangementviewcontroller))
- Move only what is needed when the device folds. Controls that vanish or jump are hard to find.
  Keep navigation outside the two-pane container.
  ([HIG Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo))
- Expect controls on the side rather than in a top bar on the outer display and on the inner
  display in landscape. Keep their positions the same across poses. Use standard components and
  you get this for free.
  ([HIG Duo](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo))
- Read the hinge only where it exists: `expo-hinge` reports on iOS 27.1 with a build from Xcode
  27.1, and returns `null` everywhere else, including the web bundle.
  ([Expo Hinge](https://docs.expo.dev/versions/latest/sdk/hinge/))

## What the app does today

- `apps/mobile/src/layout/pane-layout.ts:26` decides single or split from the window width and the
  hinge status. It stays single below 640 pt (`:3`, `:5`, `:33`). It splits in the middle when the
  hinge is `partiallyOpen` or `fullyOpen` (`:21`, `:34`). Otherwise it gives the secondary pane 380
  pt, narrowed so the primary keeps 320 pt (`:4`, `:43`).
- `apps/mobile/src/layout/use-pane-layout.ts:8` reads the window width, `:9` reads the hinge status.
- `apps/mobile/src/layout/split-panes.tsx:22` renders the two panes in a row, with a hairline border
  at `:40`. A single pane renders at `:19`.
- `apps/mobile/app.config.ts:11` allows every orientation.
- `apps/mobile/src/navigation/app-header.tsx:18` adds the top safe-area inset to the header.

## Gaps

1. Nothing renders `SplitPanes`. No screen imports it, so no posture is exercised by a live check
   today.
2. Open portrait does not split. The Duo open portrait viewport is 626 pt wide, under the 640 pt
   threshold at `pane-layout.ts:5`, so the app shows one pane where Apple's split arrangement
   stacks two.
3. The split is horizontal only. `split-panes.tsx:22` fixes `flexDirection: 'row'` and `:40` draws a
   left border, so a horizontally folded display would get a vertical border and two narrow columns.
4. Layout reads hinge status, which both Apple and Expo say not to use for layout
   (`pane-layout.ts:34`, `use-pane-layout.ts:9`). Width, height and safe area are the supported
   inputs; the hinge is for effects.
5. The status strip on the open Duo is blank: the app has no native tabs yet. Native tabs fill
   the strip (roadmap: "Projects tab (brings the tab bar)").
6. Nothing reads a size class, and the 640 pt threshold matches no documented Apple value. It sits
   between the Duo's two open widths, which happens to give the right single/split answer, but by
   accident.
7. The web bundle cannot check fold behaviour: `useHinge()` is always `null` there, and insets are
   0. A green web check says nothing about the open Duo.
8. No posture is named anywhere in the app. There is no shared map from viewport to posture, so a
   live check cannot say which posture a screenshot shows.
