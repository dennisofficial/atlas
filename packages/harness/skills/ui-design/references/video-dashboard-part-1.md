# Dashboard — timestamped narration

## Apply this

Read this when an overview or dashboard lacks hierarchy. Prioritize key values over their labels, quiet secondary controls, and group recent activity without making every card equally prominent.

> Automated local English transcription, not a manually verified verbatim transcript. Recognition and timing errors may remain. This is narration, not a summary.

- Source: `Designing a Dashboard.mp4`.
- Video duration: 17:19.98 (1039.98 seconds); extracted audio: 1039.9786875 seconds.
- Primary model: `mlx-community/whisper-large-v3-turbo`; independent checks: `mlx-community/whisper-large-v3-mlx`.
- [Complete segment/word JSON with confidence fields](../assets/video-dashboard.json).
- [Validation and coverage report](video-transcription-quality.md).
- [Continue with the table, finishing touches, and mobile layout](video-dashboard-part-2.md).

## Recognition caveats

- At 05:49, datas and fields is an uncertain recognition; the source wording is retained.
- At 08:56, all local decodes recognize left align for monetary values, although the intended decimal-alignment rule normally implies right alignment. The 09:44 frame does not unambiguously settle the spoken wording, so it is not silently corrected.
- At 13:14, the recognized service name Hefler Fonts has uncertain spelling; it is preserved.
- At 14:27, strolling is normalized to scrolling and the raw wording remains in JSON.

## Visual references

Frames are JPEG, 1280 × 720, captured at the indicated source-video times. Captions were checked against the extracted images.

- [00:05 — Data lesson title card](../assets/video-dashboard-00-05.jpg)
- [00:30 — Initial overview panels and labeled invoice cards](../assets/video-dashboard-00-30.jpg)
- [02:02 — Consolidated blue overview section](../assets/video-dashboard-02-02.jpg)
- [03:37 — Large overview values and small uppercase labels](../assets/video-dashboard-03-37.jpg)
- [04:43 — Subtle view-all actions against the blue overview](../assets/video-dashboard-04-43.jpg)
- [05:33 — Rounded new-invoice action](../assets/video-dashboard-05-33.jpg)
- [06:40 — Invoice cards with names, amounts, and a relative due date](../assets/video-dashboard-06-40.jpg)
- [07:55 — Invoice cards with softly colored status badges](../assets/video-dashboard-07-55.jpg)

## Narration

- **[00:01.00–00:05.24]** Hey everyone, in this video we're going to be taking a look at a data heavy UI.
- **[00:05.62–00:10.06]** So whether you're designing an internal application to review metrics or a product dashboard,
- **[00:10.50–00:14.28]** data can be very complex and difficult to present in a very useful way.
- **[00:14.84–00:19.98]** So for this example, we'll be taking a look at a dashboard for a fictional invoicing application.
- **[00:20.84–00:26.22]** Now before we begin making some changes, let's break this UI down a bit to see what we're working with.
- **[00:26.48–00:29.22]** So at the top here, we have some overview data.
- **[00:30.00–00:34.44]** Basically all the information that we want the user to be able to take in at a quick glance.
- **[00:34.84–00:41.70]** The second section is for all the latest invoice activity, showing the three most recent updated transactions.
- **[00:42.30–00:48.42]** And then finally, at the bottom, we have a table with more invoices displayed chronologically of when they were issued.
- **[00:48.84–00:53.80]** Essentially the same data as the section above it, presented in a more condensed way.
- **[00:54.56–00:58.68]** So let's kick things off by taking a look at the overview section.
- **[01:00.00–01:04.98]** We want this section, particularly the values, to stand out because as I previously mentioned,
- **[01:05.28–01:09.06]** we want the user to be able to take this information in at a quick glance.
- **[01:09.32–01:12.58]** But at the moment, the values don't stand out that much on the page.
- **[01:12.78–01:14.94]** There's really nothing drawing our eyes to them.
- **[01:15.56–01:21.96]** There's much more emphasis given to the elements like the header and the buttons because they have a dark blue background.
- **[01:23.22–01:32.02]** So what if we reverse that, making the header background white and consolidating the overview section and giving it a full width dark blue background?
- **[01:32.30–01:34.58]** And then of course, inverting all of the text.
- **[01:38.90–01:43.82]** This gives the overview section a much more dominant role, helping it get the attention it deserves.
- **[01:44.36–01:52.08]** We can even go as far as applying a very subtle horizontal gradient just to give it a glow to help it pop up the page that much more.
- **[01:53.08–01:59.52]** Let's also reduce the space between these elements so the overview section feels more or less like an extension of the header.
- **[01:59.52–02:02.24]** This gives us a much cleaner top section.
- **[02:02.86–02:06.86]** Now, these changes help the overview section stand out much more as a whole,
- **[02:07.08–02:12.44]** but there's still a few hierarchical issues with the way the individual data entries are presented.
- **[02:13.54–02:21.02]** First, when working with information like this, structure things to emphasize the information so it's easy to take in at a glance.
- **[02:21.28–02:25.22]** The label here is important, but it shouldn't be competing with the value.
- **[02:25.22–02:31.84]** So experiment with size, contrast, weight, and capitalization to provide clarity where it's needed.
- **[02:32.06–02:36.36]** So in this particular example, I decided to give the label a small uppercase treatment,
- **[02:36.38–02:40.64]** and I also soften the text color a bit to make the values really pop.
- **[02:41.42–02:44.84]** Now, when working on a colored background like we have here,
- **[02:45.18–02:52.96]** try to avoid the common mistake of simply making the secondary text gray to create the effect of reduced contrast.
- **[02:53.72–02:57.52]** Although this approach does the job of de-emphasizing the text,
- **[02:58.20–03:03.26]** gray text on a colored background always looks a bit off, giving it a bit of a muddy appearance.
- **[03:03.90–03:08.22]** Instead, try handpicking a new color that's based on the background color.
- **[03:08.46–03:13.18]** So the best way to do this is by using the background color as a starting point,
- **[03:13.38–03:18.26]** and increasing the lightness and adjusting the saturation until it looks right to you.
- **[03:19.42–03:25.60]** If you're having a hard time getting the desired amount of contrast and maintaining an accessible contrast ratio,
- **[03:25.84–03:30.82]** you can even take this a step further by rotating the hue to the nearest brighter color.
- **[03:31.04–03:32.54]** So in this case, cyan.
- **[03:33.04–03:37.00]** And this is a great way to keep text looking readable, but still colorful.
- **[03:39.58–03:46.16]** Okay, even though we put more emphasis on the values, they still get overpowered by these big, bold buttons.
- **[03:46.98–03:51.50]** And although these buttons are useful, they're more of a secondary action,
- **[03:51.62–03:54.40]** and we don't want the data competing with them for attention.
- **[03:55.62–03:59.94]** We could of course just make them text links, but because we're on a colored background,
- **[04:00.22–04:04.64]** it's going to be a bit difficult to give them a style that's distinguishable as a click target.
- **[04:04.64–04:08.94]** So alternatively, we could give them a more subtle button treatment,
- **[04:09.38–04:14.24]** something smaller and dark against the background just to bring more attention to the button text.
- **[04:15.98–04:21.28]** Now the background is already dark to begin with, and it even has a subtle gradient applied to it.
- **[04:21.52–04:26.40]** So we can't just handpick a color based on the background hue like we did with the label,
- **[04:26.56–04:29.78]** because buttons take up a larger surface area than text.
- **[04:29.78–04:34.82]** By simply choosing a solid color, the buttons will have a different amount of contrast against
- **[04:34.82–04:37.20]** the background depending on where it sits on the gradient.
- **[04:37.68–04:43.78]** So instead, we're going to make the buttons black and reduce the opacity so the background shows through a bit.
- **[04:45.68–04:49.02]** But let's not stop there. Let's get more creative with these buttons.
- **[04:49.02–04:55.80]** So right now, they're taking a common approach of simply rounding the corners to give them a conventional clickable look.
- **[04:56.38–05:01.34]** Let's take this a step further by fully rounding the corners to give them a softer look.
- **[05:01.78–05:09.64]** We can even go as far as adding an icon like this chevron to make them even more identifiable as a click target.
- **[05:11.70–05:18.44]** Containing the icon in a smaller circle that follows the button's rounded edge adds a nice subtle touch,
- **[05:18.58–05:22.96]** giving this button an interesting look that prevents it from getting too lost on the page.
- **[05:23.82–05:27.60]** And now that we've adopted these full rounded corner buttons,
- **[05:27.88–05:32.44]** let's try to be consistent by giving our primary page action the same treatment.
- **[05:34.32–05:37.64]** Okay, let's move on to the recent invoices section.
- **[05:39.64–05:43.98]** This is a card layout to put emphasis on the three most recent invoice transactions.
- **[05:44.50–05:48.94]** And at the moment, it's using a commonly used component to organize the data schema.
- **[05:49.90–05:55.16]** Now, remember that your UI, it doesn't need to map one to one with your datas and fields.
- **[05:55.48–05:58.56]** You don't need a label for every piece of information.
- **[05:59.10–06:02.74]** In a lot of situations similar to the data we're looking at here,
- **[06:02.96–06:08.20]** you can tell what something is by simply knowing the context and looking at the format.
- **[06:09.64–06:11.94]** It's quite clear we're looking at a client's name,
- **[06:12.12–06:17.68]** being that we're looking at a name in the recent invoices section of this invoicing application.
- **[06:18.16–06:21.28]** And by including the currency in front of this value,
- **[06:21.42–06:25.20]** it becomes quite clear that we're looking at the amount of this invoice.
- **[06:25.86–06:31.22]** Now, in some cases, it might even be helpful to change the way the information is displayed entirely.
- **[06:31.76–06:33.24]** Take this date, for example.
- **[06:33.24–06:40.08]** It might be more useful to display the date so the user doesn't have to do the math in their head to understand how soon it is.
- **[06:42.40–06:46.30]** We also need to remember that not all information should be treated equally.
- **[06:46.70–06:51.14]** And with that in mind, we can make an intended effort to make important values stand out.
- **[06:51.14–06:58.92]** So in this case, we want to make the amount stand out because it's probably the one piece of information that the user is most concerned with.
- **[07:00.06–07:05.42]** And when working with values like this status that have a level severity associated with them,
- **[07:05.64–07:09.80]** you can always use color to enrich the data to make it easier to interpret.
- **[07:09.80–07:13.74]** So for example, we could use yellow for pending transactions,
- **[07:14.22–07:17.30]** red for higher severity actions like overdue payments,
- **[07:17.48–07:20.66]** and then green to indicate which invoices have been paid.
- **[07:21.52–07:23.42]** When using bright colors like these,
- **[07:23.60–07:28.50]** you'll be surprised how dark you need to get to maintain an accessible contrast ratio.
- **[07:28.78–07:34.46]** This can interfere with the hierarchy bringing attention to something that isn't necessarily the focus of the page.
- **[07:36.56–07:39.06]** This problem can be resolved by flipping the contrast.
- **[07:39.80–07:42.88]** So instead of using white text on a dark background,
- **[07:43.14–07:45.84]** try using dark text on a softer background.
- **[07:46.32–07:50.84]** This way we're able to continue using the color to indicate the severity of the status
- **[07:50.84–07:53.90]** and still maintain a high contrast ratio.
- **[07:56.52–07:59.40]** Finally, let's give this button a little more emphasis.
- **[07:59.80–08:02.94]** Now there's no reason we can't make this entire card clickable,
- **[08:03.08–08:05.60]** but we want to make it clear that it is a click target.
- **[08:05.82–08:09.72]** So we're going to make the background where the button sits off-white.
- **[08:09.80–08:12.94]** And extend it to be the entire width of the card,
- **[08:13.14–08:15.76]** so it more or less feels like an extension of the card.
