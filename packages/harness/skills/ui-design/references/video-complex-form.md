# Complex form — timestamped narration

## Apply this

Read this when a form has many sections or conditional controls. Group fields by task, separate optional information, establish a clear primary action, and test validation and small-screen layouts without removing accessible labels.

> Automated local English transcription, not a manually verified verbatim transcript. Recognition and timing errors may remain. This is narration, not a summary.

- Source: `Designing a Complex Form.mp4`.
- Video duration: 11:12.85 (672.85 seconds); extracted audio: 672.8533125 seconds.
- Primary model: `mlx-community/whisper-large-v3-turbo`; independent checks: `mlx-community/whisper-large-v3-mlx`.
- [Complete segment/word JSON with confidence fields](../assets/video-complex-form.json).
- [Validation and coverage report](video-transcription-quality.md).

## Recognition caveats

- At 05:00, inform actions likely means in-form actions; the machine-recognized wording is preserved.
- At 08:31, boulder is corrected to border based on independent clip recognition and the visible divider.
- At 09:59, the easy fix phrase is recovered from an independent clip decode rather than inferred from context.

## Visual references

Frames are JPEG, 1280 × 720, captured at the indicated source-video times. Captions were checked against the extracted images.

- [00:05 — Forms lesson title card](../assets/video-complex-form-00-05.jpg)
- [00:30 — Initial form with dropdowns, profile fields, and plan options](../assets/video-complex-form-00-30.jpg)
- [01:56 — Billing and notifications grouped with section headings](../assets/video-complex-form-01-56.jpg)
- [02:42 — Section descriptions beside their input columns](../assets/video-complex-form-02-42.jpg)
- [03:52 — Profile input and label spacing](../assets/video-complex-form-03-52.jpg)
- [05:12 — Secondary change-picture action and cancellation link](../assets/video-complex-form-05-12.jpg)
- [06:13 — Plan cards with a highlighted selected state](../assets/video-complex-form-06-13.jpg)
- [07:47 — Payment method inset container and update action](../assets/video-complex-form-07-47.jpg)
- [09:16 — Notifications with separated cancel and save actions](../assets/video-complex-form-09-16.jpg)
- [09:32 — Cool-gray color adjustment in the editor](../assets/video-complex-form-09-32.jpg)
- [10:44 — Narrow notification layout with stacked workflow actions](../assets/video-complex-form-10-44.jpg)
- [11:03 — Closing desktop view of profile and billing sections](../assets/video-complex-form-11-03.jpg)

## Narration

- **[00:00.64–00:14.38]** Hey everyone, in this video we're going to be taking a look at form design. Forms are heavily used in SaaS applications whether it be for an onboarding experience, submitting an email, or filling out your account settings like the example we're going to be refactoring here.
- **[00:15.14–00:19.62]** Now before we get into this UI, let's just break it down a bit to see what we're working with.
- **[00:19.96–00:24.44]** So we pretty much have all of your standard inputs that you would expect from an account settings page.
- **[00:24.60–00:29.58]** We have a variety of text inputs and drop downs for your basic account information.
- **[00:30.00–00:32.88]** We have buttons to change your password or picture.
- **[00:33.34–00:38.96]** Further down the page, we have plan options presented with radio buttons and a payment method to go with it.
- **[00:39.34–00:44.44]** And then finally, we have a series of checkboxes to update the type of notifications you want to receive.
- **[00:44.88–00:48.96]** So the first thing we're going to take a look at is the white background.
- **[00:49.34–00:55.32]** Because our inputs are also white, there's not a significant amount of distinction between them and the background.
- **[00:55.32–01:00.80]** This also makes the page look busy, which could at worst result in skipping over important fields.
- **[01:01.14–01:04.32]** So we're going to make the background a subtle off-white.
- **[01:06.86–01:14.76]** And this subtle change has a significant amount of impact on the page as it gives the inputs much more distinction, making the form much more scannable.
- **[01:14.76–01:20.36]** Now, when you are working with long forms like this, it can be a bit overwhelming with all of the fields.
- **[01:20.82–01:26.80]** One way to make forms a little more digestible is to group related fields together to help the user make sense of all the information.
- **[01:27.12–01:33.42]** For example, with this form, we can group the email, password, and location settings into an account basic section.
- **[01:33.42–01:41.54]** We can also group the personal information into like a profile section and group the plan details and payment method into a billing section.
- **[01:41.84–01:45.38]** And then finally, we can keep the notifications together in their own section.
- **[01:45.84–01:48.40]** This makes the form much more easier to interpret.
- **[01:49.52–01:55.94]** You can even go as far as adding supporting text to each section just to provide a little bit more clarity to the user.
- **[01:58.42–02:00.22]** Okay, let's talk about the page width.
- **[02:00.22–02:04.28]** So at the moment, the form is stretched to fit the entire page width.
- **[02:04.46–02:08.98]** And this can be problematic because you want to use input length as an affordance.
- **[02:09.34–02:14.84]** One of the reasons I see this happening is because when you shorten the inputs, you create all this awkward white space.
- **[02:15.52–02:18.26]** Now, there's not necessarily anything wrong with that.
- **[02:18.42–02:22.80]** But a great way to deal with this is to break the page up into multiple columns.
- **[02:23.08–02:29.46]** For example, in this case, we can break the section title and supporting content that we just added out onto its own column.
- **[02:30.22–02:35.12]** This makes the design feel more balanced without compromising on the optimal width.
- **[02:35.46–02:42.42]** And these borders, they really help avoid any confusion users might get as they associate the titles with each section of the form.
- **[02:44.02–02:46.78]** Okay, let's take a closer look at these inputs.
- **[02:47.28–02:50.72]** First, everything is feeling pretty tight and unwelcoming.
- **[02:50.72–02:55.48]** Now, default inputs tend to be very small and can make the page feel crammed.
- **[02:55.72–03:02.70]** By increasing the height of the inputs, we give everything more room to breathe, making the form easier to digest.
- **[03:03.06–03:07.80]** So in this case, I'm going to give the input an overall height of 48 pixels.
- **[03:08.72–03:15.64]** And while we're focused on these inputs, we're also going to go ahead and update the drop down arrow icons to something a little more modern.
- **[03:16.34–03:23.18]** This may seem like an insignificant change, but it's many small changes like this that are going to make a big difference in the end.
- **[03:24.22–03:27.18]** Okay, let's talk about the space between these form elements.
- **[03:27.18–03:36.10]** I see this happening way too often in form design, and that is when the label for the input below it is too close to the input above it.
- **[03:36.44–03:41.54]** Not only does it make things confusing, but it also looks crammed and unprofessional.
- **[03:41.78–03:45.52]** This could even result in users putting the wrong data in the wrong field.
- **[03:46.10–03:51.74]** To fix this, increase the margin below each input so it's clear which label belongs to which input.
- **[03:53.84–03:55.98]** Okay, let's take a look at these buttons.
- **[03:56.38–04:04.56]** When there are multiple actions a user can take on a page, it's easy to fall into the trap of designing those actions based purely on semantics.
- **[04:04.82–04:06.48]** The thinking goes something like this.
- **[04:06.74–04:10.40]** If it's a positive action, make the button blue or green.
- **[04:10.76–04:14.02]** If it's a high severity action, make the button red.
- **[04:14.52–04:16.62]** Now, of course, semantics are important.
- **[04:16.86–04:20.78]** But more importantly, you need to consider the hierarchy in these situations.
- **[04:21.74–04:25.40]** So, every action on a page sits somewhere in a pyramid of importance.
- **[04:25.72–04:29.68]** When you think about it, most pages only have one true primary action.
- **[04:29.88–04:32.34]** And this button is usually given the highest contrast.
- **[04:32.78–04:35.92]** Then you might see a couple of less important secondary actions.
- **[04:35.92–04:39.38]** This could be an outline style or a lower contrast button.
- **[04:39.96–04:43.80]** And then finally, there's always a few seldomly used tertiary actions.
- **[04:44.44–04:46.96]** Styling these as links is usually the best approach.
- **[04:47.72–04:54.02]** Now, in some cases, yes, the negative action can be the primary action on the interface, like in a confirmation dialog.
- **[04:54.40–04:58.22]** But in this example, do we really want to highlight the cancel subscription option?
- **[04:58.62–04:59.60]** Probably not.
- **[05:00.36–05:04.36]** So, we're going to use a subtle outline button for the inform actions.
- **[05:04.36–05:08.12]** And a simple text link for the cancel subscription button.
- **[05:08.90–05:12.54]** And then finally, we're going to leave the bottom workflow buttons as is.
- **[05:14.40–05:17.72]** Okay, let's take a closer look at these radio buttons.
- **[05:18.10–05:20.66]** Now, I think we can get more creative with these.
- **[05:20.66–05:27.38]** I find that the more you deviate from the browser defaults, the more professional and polished your app is going to look.
- **[05:27.88–05:31.08]** Don't be limited by the typical list of options approach.
- **[05:31.52–05:36.14]** For example, we can present this information in a more exciting way by putting it into cards.
- **[05:37.32–05:41.36]** This allows us to establish a hierarchy with the information within the plan itself.
- **[05:41.62–05:47.04]** By using a combination of size and weight, we can bring more attention to the plan's differentiator.
- **[05:47.18–05:49.08]** This being the upload space values.
- **[05:50.66–05:56.54]** We can then use color to de-emphasize the repetitive labels among the plans to allow the values to pop more.
- **[06:00.66–06:06.52]** And this card treatment is also nice because it lends itself to a more interesting hover and focus states.
- **[06:06.92–06:13.18]** In this case, I can give the card a nice colored border and a friendly checkmark to indicate that it's been selected.
- **[06:14.44–06:17.14]** And now that we're better utilizing the horizontal space,
- **[06:17.14–06:24.52]** let's move the cancel option to the top right to save some vertical space and better associate it with this section of the form.
- **[06:26.26–06:30.12]** Now let's take a closer look at the payment details below this section.
- **[06:30.50–06:37.22]** So at the moment, there's no hierarchy because the title, credit card number, and expiry date are all using the same font size.
- **[06:38.76–06:46.56]** So first, let's increase the space between the title and the credit card information so they're each given their label and value affiliation.
- **[06:47.20–06:53.82]** Now, when you have multiple values like this that essentially represent the same piece of information, you don't need to give them equal attention.
- **[06:54.10–06:58.82]** In fact, this makes this section look busy, which can result in the user glazing over the data.
- **[06:59.22–07:04.64]** It's better to emphasize the identifying piece of information by making the supporting information stand back.
- **[07:04.88–07:08.12]** So in this case, the expiry date is supporting the credit card numbers.
- **[07:08.12–07:11.10]** So we're going to use size and color to attenuate it.
- **[07:13.92–07:20.68]** Now, it would be nice if we can move the update button over to the right just to maximize the horizontal space.
- **[07:20.90–07:25.48]** But by doing that, it feels overly detached from the content it's associated with.
- **[07:25.88–07:30.48]** So one way we can resolve this is by containing all the payment method information.
- **[07:31.24–07:35.42]** But to simply put it into a white container would make it stand out too much.
- **[07:35.68–07:39.88]** So instead, we're going to put it into a well so it appears like it is inset.
- **[07:40.24–07:45.34]** This makes it so it doesn't stand out an overwhelming amount, but it still does enough to draw attention to it.
- **[07:45.44–07:47.20]** It makes it so these elements are grouped.
- **[07:49.78–07:52.60]** Okay, let's move down to the notification section.
- **[07:52.86–07:59.30]** To make the labels a bit more scannable, we're going to de-emphasize the help text by making it smaller and lighter.
- **[08:00.48–08:04.38]** And much like the radio buttons, it's nice to deviate from the browser defaults.
- **[08:04.68–08:07.36]** We don't have to get too carried away with the checkboxes,
- **[08:07.48–08:10.96]** but simply just style them in such a way that better aligns with the brand.
- **[08:11.28–08:17.06]** For example, I'm going to give them the same corner radius that we're using on most of the other components on the page.
- **[08:17.66–08:22.16]** And I'm going to make the selected state the same color as our primary action.
- **[08:23.46–08:26.26]** Finally, let's make some adjustments to these workflow buttons.
- **[08:26.64–08:30.22]** Right now, they feel like they're part of just the notification section.
- **[08:30.48–08:31.54]** Not the entire form.
- **[08:31.90–08:35.50]** So the first thing we're going to do is add a border above them.
- **[08:36.96–08:43.84]** Now, when it comes to positioning the workflow buttons, there's always a debate of left aligning them or right aligning them.
- **[08:44.24–08:47.42]** Now, frankly, it doesn't make a huge difference where they are positioned.
- **[08:47.62–08:52.56]** Just as long as they are consistently placed in the same position throughout the rest of your application.
- **[08:53.12–08:59.06]** I personally have a preference of right aligning them, where the primary action is positioned on the outside.
- **[08:59.30–09:03.42]** And the reason for this is because it feels like a natural transition to the next page.
- **[09:03.64–09:06.16]** Like a book, I feel like I'm progressing from left to right.
- **[09:06.70–09:13.18]** And the border we just added is really helpful here because it makes the buttons feel connected to the content on the left.
- **[09:13.18–09:16.18]** And it draws our eyes to them, sort of like a guide.
- **[09:17.30–09:23.46]** Okay, for the finishing touches, let's saturate the grays with a bit of blue to give the design a cooler temperature.
- **[09:23.98–09:29.90]** Now, when doing this, be sure to increase the saturation intensity when working with the lighter and darker grays.
- **[09:29.90–09:31.66]** So they don't look too washed out.
- **[09:33.54–09:37.08]** Okay, this is looking like a big improvement from what we started with.
- **[09:37.24–09:40.06]** But how do we make this layout work on mobile?
- **[09:40.34–09:45.18]** Well, this new layout may utilize the space better for larger screens like on a desktop.
- **[09:45.58–09:48.82]** But it's not as easily optimized for mobile devices.
- **[09:49.30–09:54.28]** The main problem we'd run into is the two column layout that we introduced earlier in the video.
- **[09:54.64–09:58.28]** If we were to reduce the screen size, it would cause excessive wrapping.
- **[09:59.90–10:05.36]** So the easy fix here would be to return to our original stack state and then use liberal spacing to divide the sections.
- **[10:05.90–10:08.40]** And that solves the major layout problems.
- **[10:08.68–10:14.28]** But we still have some issues within the form itself, particularly these card-styled radio buttons.
- **[10:14.76–10:17.86]** So we could ultimately stack these as well.
- **[10:18.12–10:20.92]** But then we create an excessive amount of space on the right.
- **[10:21.94–10:26.52]** A better way to utilize this space is by relocating the price value to the right side.
- **[10:26.52–10:34.06]** Not only does this save us some vertical space, but it positions all the prices in a single column, making them easier to scan.
- **[10:35.30–10:41.04]** Finally, if you desire, you can make the workflow buttons full width and stack them for a cleaner look.
- **[10:41.28–10:44.58]** Just make sure you put the primary action on top.
- **[10:45.56–10:46.16]** Great.
- **[10:46.34–10:50.02]** Now let's just compare our final design with the one we started with.

## Ending coverage

The last accepted narration segment ends at 10:50.02. The remaining 22.8333125 seconds are a closing comparison/outro interval, not omitted input. Isolated local re-decodes produced no stable narration there. Suspected tail hallucinations are retained separately in the JSON rather than presented as speech.
