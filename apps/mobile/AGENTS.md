# apps/mobile

The iOS app must feel like a real iOS app, not a web page inside an iOS shell. Use the native
component for a job whenever expo-router or react-native-screens has one. Build a JS version only
when no native one exists, and say why in the PR.

## Native first

- **Navigation bar:** every screen uses the native stack header. Do not draw a custom `header`.
  iOS always centres `headerTitle`, and `headerTitleAlign` does nothing on iOS. For a leading
  title, use `leadingHeaderOptionsOf` (`src/navigation/header-options.tsx`), which places the title
  as a `custom` item in `unstable_headerLeftItems`.
- **Bar buttons:** use native bar button items (`unstable_headerLeftItems`,
  `unstable_headerRightItems`) with SF Symbols. Then iOS 26+ gives them the glass style. Use a
  React Native button in the bar only as the non-iOS fallback.
- **Back:** the native back button and the swipe-back gesture. Do not add a JS back button on iOS.
- **Search:** use `headerSearchBarOptions` with `placement: 'integratedButton'` on a screen that
  has a native bar, so search is a round bar button that expands into the field. Keep the JS
  `SearchField` only where there is no native bar, for example the sessions panel inside a session.
- **Root pages:** a tab root (and Settings on iPhone Duo) replaces the stack and does not push onto
  it (`src/navigation/root-navigation.ts`). A root page has `animation: 'none'` and no back button.
  Only a nested page slides in.
- **Scroll edge effect:** iOS 26+ attaches the bar's scroll edge effect to the first scroll view it
  finds when the screen opens. Render the list from the first frame. Show loading, error and empty
  states inside the list, and never in a view that the list replaces later.

## Layout

- Safe areas come from `react-native-safe-area-context`. Never hard-code a status bar or notch size.
- On iPhone Duo the system column is on the right. `RailContentFrame`
  (`src/layout/rail-content-frame.tsx`) keeps every screen clear of it, so do not add right padding
  on a single screen. A layer outside the frame (for example the in-app banner) adds the insets
  itself.
- The check viewports, the Duo included, are in `docs/mobile/devices.md`.

## Shipping

- Merging to `main` ships the app. The EAS Production workflow (`.eas/workflows/production.yml`)
  publishes an OTA update when a store build with the same fingerprint exists, and otherwise makes a
  native build for TestFlight. Do not check fingerprints or run `eas update` by hand, and do not
  avoid a native change to keep a change OTA-only.
