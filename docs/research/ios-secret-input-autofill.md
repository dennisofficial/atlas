# iOS Safari strong-password UI on project secret inputs

Research date: 2026-10-31. Scope: native “Use Strong Password? / Save & Fill” UI reported by the operator, not an extension's injected menu. No application changes or device reproduction performed.

## Finding

**There is no evidenced web-author switch that guarantees “masked editable secret, but never password-manager UI.”** `autocomplete="off"` is the appropriate request for these values, not an enforceable veto. Do not use `new-password` for an existing API key: it explicitly describes a newly created account password. [1][2]

**Do not conclude that CSS masking itself necessarily turns a text input into native secure text entry.** The inspected WebKit implementation computes the native trait from password type, _previous_ password type, or a host override—not `textSecurity()`. Its input-type classifier likewise does not inspect that CSS property. CSS does mask rendered text. These are separate mechanisms. Safari's complete strong-password classification is not established by these open-source paths; the reported popup on a freshly loaded text-only page remains a real observation, not something this source analysis disproves. [3][4][5]

Best next step: first test the current text implementation after a **full reload/new document**, not merely a hot update from the previous password implementation. WebKit intentionally retains secure-entry behavior on an input that **has ever been a password field**. If the popup persists on a fresh document, a masked `<textarea autocomplete="off">` is a source-motivated **experiment**, not a guaranteed fix. If that also fails, use visible editing with masking outside edit mode, or retain native password entry and accept manager involvement. [3][6][7]

## Actual repository control

`apps/web/src/features/projects/new-project-secrets-editor.tsx`:
- Lines 71–89: value `Input` has `type="text"`, `autoComplete="off"`, `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}`, `data-1p-ignore`, and `data-lpignore="true"`.
- Lines 72, 80–84: id is `project-secret-value-${index}`; CSS toggles `-webkit-text-security:disc` / `none`. No `name`, `inputMode`, `passwordrules`, or password autocomplete token is specified on this control.
- Lines 53–65: the adjacent Name field is a text-like `Input`, with placeholder `API_KEY`; its label is “Name”, value label is “Value”.
- Lines 28–38, 132–149: the existing Paste .env path uses an **unmasked textarea**, intercepts paste, parses clipboard text, adds pairs, and closes the paste control; its controlled value remains empty. It is not already a masked textarea implementation.
- `packages/ui/src/components/input.tsx:5–21` forwards type and other attributes to Base UI's Input; `packages/ui/src/components/textarea.tsx:4–13` renders a literal `<textarea>` and forwards props. This is a source/JSX inspection, not a capture of the device's final DOM or computed styles.

The screenshot itself was not supplied to this research thread. Native UI identification is taken from the operator's explicit description; do not relabel it as 1Password/LastPass simply because those ignore attributes are present.

## Evidence: secure entry, masking, and autofill are different

All WebKit links below are pinned to inspected revision `8fa4be1c3258173471bb4250e2ff7eb77544cd71` (main fetched during research). This is **not** a claim about the exact WebKit build on the affected iPhone.

### Native secure entry remembers password history — supported

[3], `WKContentViewInteraction.mm:7264–7266`:

```objc
traits.secureTextEntry = _focusedElementInformation.elementType == WebKit::InputType::Password || _focusedElementInformation.hasEverBeenPasswordField || [_formInputSession forceSecureTextEntry];
```

[8], `HTMLInputElement.cpp:629–630`, sets `m_hasEverBeenPasswordField = true` if `isPasswordField()`. [6], the iOS API test `SecureTextEntryAfterChangingInputTypeFromPassword`, starts with a password input, changes the **same node** to text, and still asserts `secureTextEntry == true` (`KeyboardInputTestsIOS.mm:617–624`). Focusing a second, originally text input asserts false (`626–627`).

**Inference, not reproduced diagnosis:** hot replacement/reuse of the old password DOM node could explain why the replacement appeared ineffective. The test establishes sticky native secure entry, **not** that this history alone produces the particular strong-password dialog. A new document removes that old node history; it does not disable all Safari heuristics.

### CSS text-security masks rendering — supported; popup causation unproven

[4], `WebPage.cpp:8270–8329`, returns `TextArea` for `<textarea>`, `Password` for `isPasswordField()`, and `Text` for ordinary text inputs. There is no CSS-security check in that classifier.

[5], `RenderText.cpp:1798–1845`, switches on `style.textSecurity()`; on iOS, circle/disc/square call `secureText(blackCircle)`, preserving original text separately from rendered text. This proves masking, **not** a password-autofill opt-out or password-field classification.

[9], `HTMLInputElement.h:149`, separately defines `isSecureField()` as `isPasswordField() || autofilledAndObscured()`; [10], `AccessibilityNodeObject.cpp:1160–1165`, only delegates secure-field classification to an `HTMLInputElement`. Do not assume CSS-masked text/textarea has all native password accessibility or keyboard privacy behavior. In particular, “visually masked” is not a promise that the value is hidden from assistive technology, copy/paste, scripts, or a keyboard's learning features.

[11], `computed-text-security-for-input-security.html:14–43`, tests computed CSS for text/password inputs with a test-enabled `input-security` feature. [12], `text-security.html:35–49`, masks ordinary spans. These are **rendering tests**, not tests that Safari's native strong-password prompt is suppressed. No directly applicable native-popup suppression test for masked textarea was located in the inspected test paths; that is not proof one does not exist elsewhere.

### Why textarea is worth testing — supported distinction, speculative outcome

[7], `WebPageIOS.mm:2849–2888`, has separate branches:
- Textarea: passes value, autocomplete field name, inputmode, and editing traits.
- Input: additionally calls `AutofillElements::computeAutofillElements`, sets `acceptsAutofilledLoginCredentials`, and copies `hasEverBeenPasswordField`.

[13], `AutofillElements.cpp:41–44,92–123`, considers input text/email fields and identifies adjacent password fields or explicitly tagged usernames. It does not take a textarea as the starting element. Its password branch even says: “Always allow AutoFill in a password field, even if we fill information only into it.” [14], `WKWebViewAutofillTests.mm:192–202`, tests that a standalone password input accepts credentials; removing the surrounding `<form>` or username is therefore not a reliable strategy.

**Inference:** a textarea avoids these particular input-only credential/history paths while retaining browser text editing and CSS rendering. However, it still carries autocomplete metadata, and HTML defines autofill behavior for textarea too [1]. This is not proof that Safari's other classifiers or the OS will never offer passwords. `rows={1}` affects presentation, not multiline semantics or autofill eligibility.

## Apple guidance and HTML constraints

1. **`off` is meaningful, but not absolute.** HTML [1] describes it as appropriate when data is “particularly sensitive” or will not be reused. The same section states: “A user agent may allow the user to override an element's autofill field name, e.g. to change it from ‘off’ to ‘on’ … despite the page author's objections”. It provides no API-key-specific autofill token.
2. **`new-password` actively identifies the wrong task.** Apple [2] says: “When creating a new account or changing the password, use the `new-password` attribute value instead”. It documents heuristics and notes: “the heuristics assume that password and new password inputs always use secure text”. That describes heuristic assumptions, not a documented rule equating every CSS-masked field with a password. Apple's workflow page [15] says untagged fields are identified using heuristics.
3. **`passwordrules` configures generation, not suppression.** Apple [16]: “To customize password rules for an automatically generated password” use the HTML `passwordrules` attribute. It says incompatible restrictions “will be ignored by the user agent”. Omitting the attribute uses default rules. Empty, invalid, or impossible rules are not a supported off switch.
4. **`inputmode` is a keyboard hint, not an autofill veto.** HTML [17] says it specifies “what kind of input mechanism would be most helpful”. WebKit [18] maps it to `keyboardType` separately from `secureTextEntry` and `textContentType`. `inputmode="text"` can express the intended keyboard but has no evidenced popup-suppression guarantee. Numeric/email modes harm arbitrary key entry; `none` requests no virtual keyboard and is not a usable suppression solution.
5. **Other autocomplete tokens are not a truthful workaround.** `current-password` describes an existing login password and can request credential filling; `one-time-code` describes an identity-verification code [1][2], not a durable API key. Apple explicitly supports SMS-code suggestions for the latter. Neither should be used to trick classification here. Keep capitalization, correction, and spellcheck off to avoid corrupting keys; they do not document a password-manager opt-out.
6. **Extension ignore attributes are separate.** 1Password [19] documents `data-1p-ignore` as telling **1Password** to ignore a field. This is not an Apple/Safari contract. Nothing in the consulted Apple guidance makes either existing vendor attribute a native strong-password control. Also, native AutoFill can have third-party credential providers; the UI's native appearance does not by itself identify which provider is enabled [20].

## Recommendation and options

**Recommended investigation order:** validate clean-node behavior first, then trial a masked textarea on the actual iPhone. Do not ship another confidently worded attribute-only “fix”.

| Option                                            | Benefit                                                                     | Cost / uncertainty                                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current text input + CSS disc, freshly mounted    | Smallest change; preserves single-line editing and masking                  | Already reported ineffective; clean-node test only isolates historical type. No suppression guarantee.                                                                     |
| Textarea + CSS disc + `autocomplete="off"`        | Retains visual masking; avoids identified input-only autofill/history paths | Candidate only. Audit multiline/paste handling, sizing, Enter behavior, VoiceOver, reveal, selection, keyboard privacy, and CSS-off exposure. No device result yet.        |
| Visible text editing; mask stored/blurred display | Removes both password type and CSS-security signal from the active editor   | Deliberate shoulder-surfing/screen-recording exposure while editing. Safari can still apply heuristics. Explain visibility and provide deliberate edit/reveal affordances. |
| Native password field + `autocomplete="off"`      | Native secure-entry behavior rather than visual masking alone               | Accept that password-manager/generation UI may occur. Never label API keys `new-password`.                                                                                 |
| Existing Paste .env/import-oriented flow          | Already avoids a persistent masked entry field during paste                 | Less convenient for manual edits; clipboard itself is sensitive. No guarantee for Safari UI. An import-only redesign is a separate product decision.                       |

Avoid hidden dummy credentials, arbitrary autocomplete strings, renaming labels to deceive managers, readonly-until-focus tricks, synthetic keyboards, or custom bullet-value editors as purported fixes: no primary-source suppression contract was found, and these trade stable editing/accessibility for heuristic evasion.

If masked textarea still triggers on a clean document, the defensible choices are to accept native manager involvement with proper secure fields, or relax **masking during editing**. None of the inspected sources establishes an author-controlled combination guaranteeing both full native secure-entry semantics and no manager UI.

## Required real-device checks before calling anything fixed

- Record iPhone model, exact iOS/Safari version, Safari versus installed PWA/web view, keyboard, enabled AutoFill providers/extensions, and account/history state. Use a dummy token, never production credentials.
- On a full load of the same project-creation context, compare fresh text+disc, fresh text without disc, masked textarea, unmasked textarea, and a password+off baseline. Keep labels/adjacent fields constant; test empty and populated values, one and multiple pairs.
- Separately reproduce password → text **on the same node**, and compare a newly created text node. Capture actual tag/type/autocomplete attributes, computed `-webkit-text-security`, and whether the popup occurs on focus, typing, paste, reveal, or submission. Do not log secret values.
- With extensions disabled but Apple AutoFill enabled, distinguish browser-native behavior from injected extension UI; then repeat with the user's configured providers. Turning AutoFill off is diagnostic/user preference, not a website-delivered fix.
- Verify long keys, paste, selection/replacement/deletion, dictation/IME, VoiceOver output, reveal/hide, newline handling, keyboard corrections, and focus retention. CSS masking alone is not a security boundary.

Desktop Playwright/WebKit or a DOM assertion can verify markup/rendering, **not** certify this iOS system dialog. This sandbox had no affected real device; no suppression outcome has been verified.

## Primary sources

[1]: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofilling-form-controls:-the-autocomplete-attribute
[2]: https://developer.apple.com/documentation/security/enabling-password-autofill-on-an-html-input-element
[3]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm#L7264-L7266
[4]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Source/WebKit/WebProcess/WebPage/WebPage.cpp#L8270-L8329
[5]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Source/WebCore/rendering/RenderText.cpp#L1798-L1845
[6]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Tools/TestWebKitAPI/Tests/WebKit/WKWebView/ios/KeyboardInputTestsIOS.mm#L608-L627
[7]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Source/WebKit/WebProcess/WebPage/ios/WebPageIOS.mm#L2849-L2888
[8]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Source/WebCore/html/HTMLInputElement.cpp#L629-L630
[9]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Source/WebCore/html/HTMLInputElement.h#L149
[10]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Source/WebCore/accessibility/AccessibilityNodeObject.cpp#L1160-L1165
[11]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/LayoutTests/fast/css/computed-text-security-for-input-security.html#L14-L43
[12]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/LayoutTests/fast/css/text-security.html#L35-L49
[13]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Source/WebCore/editing/cocoa/AutofillElements.cpp#L41-L123
[14]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Tools/TestWebKitAPI/Tests/WebKit/WKWebView/ios/WKWebViewAutofillTests.mm#L192-L202
[15]: https://developer.apple.com/documentation/security/about-the-password-autofill-workflow
[16]: https://developer.apple.com/documentation/security/customizing-password-autofill-rules
[17]: https://html.spec.whatwg.org/multipage/interaction.html#attr-inputmode
[18]: https://github.com/WebKit/WebKit/blob/8fa4be1c3258173471bb4250e2ff7eb77544cd71/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm#L7314-L7376
[19]: https://www.1password.dev/web/compatible-website-design/#ignore-offers-to-save-or-fill-specific-fields
[20]: https://developer.apple.com/videos/play/wwdc2018/204/

Apple documentation prose was read from Apple's first-party DocC JSON equivalents under `https://developer.apple.com/tutorials/data/documentation/security/<article-slug>.json`; the normal documentation pages above require client rendering. Search was rate-limited; findings derive from directly retrieved primary pages, source files, and tests, not search snippets.
