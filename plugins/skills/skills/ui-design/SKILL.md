---
name: ui-design
description: Default guidance for every UI task. Use whenever designing, building, changing, polishing, debugging, or reviewing web, mobile, or terminal interfaces, including layout, spacing, visual hierarchy, typography, color palettes, components, forms, tables, dashboards, navigation, images, and empty, loading, or error states.
---

# UI design

Use this skill for every UI task, alongside any relevant platform or component-library skills. Start with the existing product, not a blank design system.

## Workflow

1. Inspect the feature, its actual content, the current interface, and the project's tokens and components. Identify the primary action and secondary information.
2. Choose the relevant references below and read those files directly. Each file contains an application checklist and complete source text with page images; do not preload the whole library.
3. Solve content, hierarchy, layout, spacing, and typography before polishing color, borders, shadows, and imagery. Work in small cycles against a usable interface.
4. Implement with the project's styling system. Reuse established tokens, components, density, and platform conventions; sample palettes and font combinations are options, not instructions to replace them.
5. Inspect the rendered result. Check supported sizes, long content, empty/loading/error states, primary-action visibility, contrast, keyboard/focus behavior, and accessible names. Report checks you could not perform.

Visual examples are part of the explanation. Open the linked source-page images when a decision depends on appearance. For content-heavy screens, complex forms, and dashboards, read the relevant timestamped walkthrough and its frames.

## Guardrails

- Express importance through multiple signals: placement, spacing, size, weight, and contrast. Color alone does not communicate state.
- Preserve semantic markup, heading structure, and accessible names. Simplifying visible labels is not permission to remove input labels or other accessibility information.
- Establish a small, consistent set of spacing, type, and color choices rather than inventing a new value for each element.
- Adapt examples to the actual platform. Browser screenshots illustrate visual principles, not terminal or native implementation contracts.
- Treat historical font-provider and license listings as source information, not verified current availability. Verify licensing before adopting a font.
- Palette assets preserve the original JSON-with-comments format, including role comments and trailing commas. Keep each palette's namespaced values intact; similarly named colors in global swatches can differ.

## References

The index below links directly to answer-bearing files. Read only the topics needed for the current task. The source is Refactoring UI by Adam Wathan and Steve Schoger and its supplemental PDFs; original wording remains in each reference rather than being replaced by summaries. All PDF pages also have visual renders. Walkthroughs contain automated speech transcripts, not manually verified verbatim records.

### Start with the feature

- [Feature-first interface design](references/feature-first-design.md)
- [Delay detail while exploring](references/early-design-detail.md)
- [Design in implementation cycles](references/iterative-interface-design.md)
- [Choose a consistent interface personality](references/interface-personality.md)
- [Limit design choices deliberately](references/constrained-design-systems.md)

### Visual hierarchy

- [Give important elements visual priority](references/visual-hierarchy.md)
- [Build hierarchy with weight and color](references/hierarchy-size-weight-color.md)
- [Use readable text on colored surfaces](references/text-on-colored-surfaces.md)
- [Emphasize by quieting competitors](references/deemphasis-for-hierarchy.md)
- [Make labels secondary to useful values](references/labels-and-values.md)
- [Separate visual and document hierarchy](references/visual-and-document-hierarchy.md)
- [Balance visual weight and contrast](references/hierarchy-weight-and-contrast.md)
- [Style actions by priority, not meaning alone](references/action-hierarchy-and-semantics.md)

### Layout and spacing

- [Start with generous whitespace](references/generous-whitespace.md)
- [Establish a spacing and sizing scale](references/spacing-and-sizing-scale.md)
- [Fit the canvas to the content](references/content-width-and-columns.md)
- [Use grids without forcing every element to stretch](references/layout-beyond-grids.md)
- [Scale component parts independently](references/independent-component-scaling.md)
- [Use spacing to clarify groups](references/unambiguous-group-spacing.md)

### Typography

- [Choose a practical type scale](references/type-scale.md)
- [Select fonts for dependable legibility](references/legible-font-selection.md)
- [Constrain text line length](references/readable-line-length.md)
- [Align mixed-size text on the baseline](references/text-baseline-alignment.md)
- [Adjust line height to reading conditions](references/line-height-and-reading-density.md)
- [Style links according to context](references/contextual-link-styling.md)
- [Align content for reading and comparison](references/text-and-number-alignment.md)
- [Tune letter spacing deliberately](references/letter-spacing.md)

### Color systems

- [Adjust colors using hue, saturation, and lightness](references/hsl-color-adjustment.md)
- [Build complete color systems](references/complete-color-systems.md)
- [Define color shades before using them](references/predefined-color-shades.md)
- [Preserve saturation across light and dark shades](references/saturation-and-perceived-brightness.md)
- [Give neutrals a deliberate temperature](references/warm-and-cool-neutrals.md)
- [Keep color accessible without flattening the design](references/accessible-color-combinations.md)
- [Communicate meaning beyond color](references/redundant-color-cues.md)

### Depth and surfaces

- [Use a consistent light source](references/consistent-light-source.md)
- [Use shadows as an elevation scale](references/elevation-shadow-scale.md)
- [Combine shadows for credible depth](references/two-part-shadows.md)
- [Create depth without blurred shadows](references/flat-surface-depth.md)
- [Use overlap to establish layers](references/overlapping-layers.md)

### Images and icons

- [Choose photos that support the interface](references/quality-photo-selection.md)
- [Stabilize contrast for text over images](references/text-over-image-contrast.md)
- [Respect the intended size of images and icons](references/image-and-icon-native-size.md)
- [Contain unpredictable uploaded images](references/user-uploaded-image-containment.md)

### Polish and UI states

- [Upgrade default-looking elements](references/polished-default-elements.md)
- [Add restrained color with accent borders](references/accent-borders.md)
- [Decorate backgrounds without competing with content](references/background-decoration.md)
- [Make empty states useful](references/empty-state-guidance.md)
- [Separate content with fewer borders](references/alternatives-to-borders.md)
- [Rethink familiar component compositions](references/component-composition.md)

### Design practice

- [Develop judgment by studying interfaces](references/interface-observation-practice.md)

### Component and screen patterns

- [Button shapes and states](references/button-shapes-and-states.md)
- [Input surfaces and labels](references/input-surfaces-and-labels.md)
- [Input and action groups](references/input-action-groups.md)
- [Form validation feedback](references/form-validation-feedback.md)
- [Badge treatments](references/badge-treatments.md)
- [Breadcrumb navigation](references/breadcrumb-navigation.md)
- [Pagination controls](references/pagination-controls.md)
- [Horizontal navigation states](references/horizontal-navigation-states.md)
- [Vertical navigation groups](references/vertical-navigation-groups.md)
- [Table density and grouping](references/table-density-and-grouping.md)
- [Sign-in form layouts](references/sign-in-form-layouts.md)
- [Alert surface patterns](references/alert-surface-patterns.md)
- [Pricing comparison layouts](references/pricing-comparison-layouts.md)
- [Marketing hero layouts](references/marketing-hero-layouts.md)
- [Marketing feature sections](references/marketing-feature-sections.md)
- [Modal composition](references/modal-composition.md)
- [Multi-section form layouts](references/multi-section-form-layouts.md)
- [Header navigation composition](references/header-navigation-composition.md)
- [Preview card layouts](references/preview-card-layouts.md)
- [Profile card layouts](references/profile-card-layouts.md)
- [Application shell layouts](references/application-shell-layouts.md)
- [Footer information layouts](references/footer-information-layouts.md)
- [Activity feed layouts](references/activity-feed-layouts.md)
- [Checkout and order-summary layouts](references/checkout-summary-layouts.md)
- [Testimonial composition](references/testimonial-composition.md)
- [Gallery source closing and requests](references/gallery-source-closing.md)

### Font specimens and pairings

- [Font reference provenance](references/font-source-introduction.md)
- [Headline font pairings: Proxima through Meta Serif](references/headline-font-pairings.md)
- [Headline font pairings: Roboto through Adelle](references/headline-font-personality.md)
- [Article font pairings and reading texture](references/article-font-readability.md)
- [Application font specimens and weight ranges](references/application-font-specimens.md)
- [Further application font specimens](references/application-font-alternatives.md)

### Complete color palettes

- [Color palette 01: cyan](references/color-palette-01.md)
- [Color palette 02: blue, yellow-vivid](references/color-palette-02.md)
- [Color palette 03: purple, teal](references/color-palette-03.md)
- [Color palette 04: teal](references/color-palette-04.md)
- [Color palette 05: blue-grey](references/color-palette-05.md)
- [Color palette 06: red, yellow-vivid](references/color-palette-06.md)
- [Color palette 07: cyan](references/color-palette-07.md)
- [Color palette 08: blue-vivid](references/color-palette-08.md)
- [Color palette 09: light-blue-vivid](references/color-palette-09.md)
- [Color palette 10: indigo](references/color-palette-10.md)
- [Color palette 11: pink-vivid](references/color-palette-11.md)
- [Color palette 12: green](references/color-palette-12.md)
- [Color palette 13: yellow-vivid, light-blue-vivid](references/color-palette-13.md)
- [Color palette 14: orange, lime-green](references/color-palette-14.md)
- [Color palette 15: blue](references/color-palette-15.md)
- [Color palette 16: purple, red-vivid](references/color-palette-16.md)
- [Color palette 17: magenta, orange-vivid](references/color-palette-17.md)
- [Color palette 18: purple](references/color-palette-18.md)
- [Color palette 19: indigo, orange-vivid](references/color-palette-19.md)
- [Color palette 20: light-blue, green](references/color-palette-20.md)
- [Color palette 21: orange-vivid](references/color-palette-21.md)
- [Color palette 22: indigo, cyan-vivid](references/color-palette-22.md)
- [Color palette 23: teal-vivid](references/color-palette-23.md)
- [Color palette 24: yellow](references/color-palette-24.md)

### Color swatches

- [Red, orange, yellow, and lime swatches](references/warm-and-lime-color-swatches.md)
- [Green, teal, cyan, and light-blue swatches](references/green-teal-and-cyan-swatches.md)
- [Blue, indigo, purple, and magenta swatches](references/blue-purple-and-magenta-swatches.md)
- [Pink and neutral swatches](references/pink-and-neutral-swatches.md)

### Timestamped design walkthroughs

- [Content-heavy pages: reading, hierarchy, and responsive composition](references/video-content-design.md)
- [Complex forms: field grouping, controls, and mobile layout](references/video-complex-form.md)
- [Dashboards: overview hierarchy and recent activity](references/video-dashboard-part-1.md)
- [Dashboards: tables, typography, and responsive layout](references/video-dashboard-part-2.md)
- [Transcription method, recognition caveats, and coverage](references/video-transcription-quality.md)

### Source introductions

- [Design reference provenance and contents](references/design-source-introduction.md)
- [Color palette reference provenance](references/color-palette-source-introduction.md)
- [Component example provenance](references/component-gallery-provenance.md)

