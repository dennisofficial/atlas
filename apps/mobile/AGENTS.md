# apps/mobile

The iOS app must feel like a real iOS app, not a web page inside an iOS shell. Use the native
component for a job whenever expo-router or react-native-screens has one. Build a JS version only
when no native one exists, and say why in the PR.

Native first does not mean the stock iOS look everywhere. Where a stock control looks worse than
the Atlas design, use the Atlas one. Loading uses `Spinner` from `@dltech/atlas-ui-native` (the
web spinner), never `ActivityIndicator`.

## Native first

- **Navigation bar:** every screen uses the native stack header. That includes a full-screen
  modal and a screen whose content runs under the bar (`headerTransparent: true`). Do not draw a
  custom `header`, and do not float a JS row of buttons over the content instead of a bar. Only
  the native bar gets these from iOS: its place in the iPhone Duo status strip (top in open
  portrait, beside the clock), safe areas, rotation and the glass style. A JS row has to compute
  them again and gets them wrong (#3024 floated one in the photo viewer; it sat under the Duo
  strip and stuck at the old orientation after a rotation). iOS always centres `headerTitle`, and
  `headerTitleAlign` does nothing on iOS. For a leading title, use `leadingHeaderOptionsOf`
  (`src/navigation/header-options.tsx`), which places the title as a `custom` item in
  `unstable_headerLeftItems`. Its `titleButtons` counts every other bar button on the screen.
  `HEADER_EDGE_SLACK` covers the bar margins (16 pt a side) and the glass inset (8 pt) with a few
  points to spare. With too little room, iOS moves every bar item into one overflow "…" menu.
- **Hiding the bar on a live screen:** a modal (`fullScreenModal`, `modal`) that shows a header
  renders its content inside a nested native stack (`isHeaderInModal`,
  react-native-screens `ScreenStackItem.tsx:101`). Toggling `headerShown` there swaps that tree and
  remounts the content, so its state, scroll and zoom reset. To hide and show the bar with the
  native animation, give the modal its own `Stack` (`_layout.tsx`) with `headerShown: false` on
  the modal and toggle `headerShown` on the screen inside it, as `src/app/(app)/photo/` does.
- **Bar buttons:** use native bar button items (`unstable_headerLeftItems`,
  `unstable_headerRightItems`) with SF Symbols. Then iOS 26+ gives them the glass style. Use a
  React Native button in the bar only as the non-iOS fallback.
- **Leading title:** give the title item `visibilityPriority: 'high'`. On iOS 27 a bar that runs out
  of room moves low-priority items into a "…" overflow menu, and a custom view shows nothing there.
  expo-router 58 drops the prop for a `custom` item, so `patches/expo-router@58.0.30.patch` passes
  it through. Keep the patch, or confirm upstream passes the prop, when expo-router is upgraded.
- **Header taps:** from iOS 27 on iPhone, a tap anywhere on the native bar scrolls the screen's
  scroll view to the top, a tap on a custom header view included
  (facebook/react-native#56061). `leadingHeaderOptionsOf` wraps its title views in
  `ScrollToTopGuard` (`react-native-screens/experimental`) so a tap on them does not scroll. Wrap
  any other custom header view the same way.
- **Back:** the native back button and the swipe-back gesture. Do not add a JS back button on iOS.
  A pushed screen (Settings, Sub-agent, Project settings) uses `pushedHeaderOptionsOf`: the native
  back button followed by the same glass leading title as the tab screens.
- **Search:** use `headerSearchBarOptions` with `placement: 'integratedButton'` on a screen that
  has a native bar, so search is a round bar button that expands into the field. Keep the JS
  `SearchField` only where there is no native bar, for example the sessions panel inside a session.
- **Tabs:** the four destinations are `NativeTabs` triggers under `src/app/(app)/(tabs)/`. Each tab
  root is its own `Stack` (`TabRootStack`, `src/navigation/tab-root-stack.tsx`) with
  `animation: 'none'` and no back button, so only a nested page slides in. Settings is pushed from
  the avatar button in every tab's header, and a tab bar holds destinations only.
- **Scroll edge effect:** iOS 26+ attaches the bar's scroll edge effect to the first scroll view it
  finds when the screen opens. Render the list from the first frame. Show loading, error and empty
  states inside the list, and never in a view that the list replaces later.
- **Glass bars:** on iOS 26+ every bar is transparent and content scrolls under it. Set bar
  colours through `barHeaderOptionsOf` (`src/navigation/glass-header.ts`), never a plain
  `headerStyle.backgroundColor`, which makes the bar opaque. A scroll view under the bar uses
  `contentInsetAdjustmentBehavior="automatic"`, not a top padding: the edge blur and the rest
  position after a rotation both come from the native inset.

## Layout

- Safe areas come from `react-native-safe-area-context`. Never hard-code a status bar or notch size.
- On iPhone Duo the native tab bar sits in the system column on the right. iOS places the bar but
  does not keep screen content out of the column: `SideInsetFrame`
  (`src/layout/side-inset-frame.tsx`) pads the tab's whole `Stack` by `sideColumnInsetOf`
  (`src/layout/posture.ts:12`), and for sessions the `SessionsDrawer` too, so the native header,
  the drawer list and the screen content all stop at the column. It wraps the tab's stack in the
  tab's `_layout.tsx`, never `screenLayout`: `screenLayout` sits inside the native screen, which
  leaves the native header and a drawer rendered beside the stack at full width. It never wraps
  `NativeTabs`, and the root stack keeps `screenLayout={SideInsetLayout}`, because a frame there
  would push `NativeTabs` out of the column. Do not add right padding on a single screen, and do
  not draw a bar of your own there. Width-dependent layout (`useContentWidth`,
  `src/layout/use-content-width.ts`) measures the padded frame, not the window.
- A `fullScreenModal` draws over the tab bar and its column. It wraps itself in its own
  `SafeAreaProvider` so its insets follow the window while it is open, and pads itself by
  `sideColumnInsetOf` of those insets. See `src/app/(app)/photo/index.tsx`.
- The check viewports, the Duo included, are in `docs/mobile/devices.md`.

## Shipping

- Merging to `main` ships the app. The EAS Production workflow (`.eas/workflows/production.yml`)
  publishes an OTA update when a store build with the same fingerprint exists, and otherwise makes a
  native build for TestFlight. Do not check fingerprints or run `eas update` by hand, and do not
  avoid a native change to keep a change OTA-only.
- Every `expo export` (and so the workflow's `eas update`) needs `EXPO_NO_BUNDLE_SPLITTING=1`.
  Without it, @expo/cli 58 renames the split chunks of a DOM component (`'use dom'`) to their md5
  hashes but keeps the old names in their `requires`, and the export fails with `Asset not found:
  _expo/static/js/web/__common-<hash>.js`. The native bundle does not split, so the flag changes
  only the DOM bundles.
- `eas/posthog_upload_sourcemaps` reads `dist/_expo/static/js/ios` only. A DOM component also
  exports a web bundle, and its map carries a debug id but no `x_hermes_function_offsets`, so
  posthog-cli's Hermes upload stops on it with `Map is not a hermes sourcemap`.
