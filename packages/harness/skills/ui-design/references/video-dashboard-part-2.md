# Dashboard — timestamped narration

## Apply this

Read this when refining data tables and responsive dashboards. Make columns easy to compare, keep actions distinct from data, and check typography and the mobile layout. Verify numerical alignment against the rendered table; uncertain recognized wording below is not an implementation rule.

> Automated local English transcription, not a manually verified verbatim transcript. Recognition and timing errors may remain. This is narration, not a summary.

- Source: `Designing a Dashboard.mp4`.
- Video duration: 17:19.98 (1039.98 seconds); extracted audio: 1039.9786875 seconds.
- Primary model: `mlx-community/whisper-large-v3-turbo`; independent checks: `mlx-community/whisper-large-v3-mlx`.
- [Complete segment/word JSON with confidence fields](../assets/video-dashboard.json).
- [Validation and coverage report](video-transcription-quality.md).
- [Previous: overview and recent invoice cards](video-dashboard-part-1.md).

## Recognition caveats

- At 05:49, datas and fields is an uncertain recognition; the source wording is retained.
- At 08:56, all local decodes recognize left align for monetary values, although the intended decimal-alignment rule normally implies right alignment. The 09:44 frame does not unambiguously settle the spoken wording, so it is not silently corrected.
- At 13:14, the recognized service name Hefler Fonts has uncertain spelling; it is preserved.
- At 14:27, strolling is normalized to scrolling and the raw wording remains in JSON.

## Visual references

Frames are JPEG, 1280 × 720, captured at the indicated source-video times. Captions were checked against the extracted images.

- [09:44 — Roomier invoice table with alternating row backgrounds](../assets/video-dashboard-09-44.jpg)
- [10:34 — Enriched table with portraits and readable dates](../assets/video-dashboard-10-34.jpg)
- [11:44 — Dashboard cards and table on an off-white surface](../assets/video-dashboard-11-44.jpg)
- [14:07 — Proxima Nova font specimens in the browser](../assets/video-dashboard-14-07.jpg)
- [15:27 — Narrow overview with view-all actions positioned to the right](../assets/video-dashboard-15-27.jpg)
- [16:48 — Narrow transaction table with names, amounts, and status dots](../assets/video-dashboard-16-48.jpg)
- [17:10 — Closing desktop view of invoice cards and enriched table](../assets/video-dashboard-17-10.jpg)

## Narration

- **[08:19.38–08:22.28]** Okay, let's move on to the table at the bottom.
- **[08:22.88–08:27.36]** So first thing we're going to do is contain the table in a panel with rounded corners,
- **[08:27.38–08:29.92]** so it's consistent with the other cards on the page.
- **[08:31.88–08:33.60]** Styling tables can be tricky.
- **[08:33.60–08:37.24]** It's often a lot of data to present in a condensed space.
- **[08:38.50–08:42.72]** Fortunately, there are a few tricks to make content a little more digestible.
- **[08:43.04–08:44.76]** So first, use alignment.
- **[08:45.48–08:47.70]** Aligning columns makes tables much more scannable
- **[08:47.70–08:50.42]** and makes the boundaries much clearer between columns.
- **[08:50.42–08:54.54]** So for most content, it makes sense to left align the text.
- **[08:54.78–08:56.70]** But for content like dollar values,
- **[08:56.86–09:01.02]** it's wise to left align them so the decimal places are in columns.
- **[09:01.26–09:04.52]** This makes it much easier to compare the numbers' magnitudes.
- **[09:05.80–09:08.86]** Next thing we want to do is increase the row space.
- **[09:09.12–09:12.88]** Give your text room to breathe so your rows are much more scannable.
- **[09:13.20–09:16.62]** Just let the alignment do the work of keeping columns in order.
- **[09:18.00–09:19.66]** Let's also take a look at the borders.
- **[09:20.02–09:23.54]** While borders are a great way to distinguish two elements from each other,
- **[09:24.08–09:27.18]** too many of them can make your design feel busy and cluttered.
- **[09:27.48–09:32.00]** A more subtle way to create distinction with tables is to use zebra striping.
- **[09:36.20–09:40.40]** Finally, we're going to de-emphasize the headings to allow the data to pop
- **[09:40.40–09:43.50]** by using a combination of smaller, softer text.
- **[09:44.52–09:47.16]** Okay, this table is already looking much cleaner,
- **[09:47.42–09:50.00]** but there's a few other ideas we can explore.
- **[09:50.46–09:53.30]** First, if columns don't need to be sortable,
- **[09:53.80–09:57.12]** try consolidating secondary information for a cleaner look.
- **[09:57.36–10:02.26]** And if appropriate, consider de-emphasizing it using smaller and lighter text.
- **[10:03.86–10:07.44]** If the data calls for it, try enhancing it by including images.
- **[10:07.44–10:12.26]** We're also going to update the dates as something users are more familiar with
- **[10:12.26–10:17.16]** and present the due dates as more human-readable phrases instead of the actual date.
- **[10:21.86–10:24.84]** And again, like the card examples above this section,
- **[10:25.12–10:28.20]** use color to enrich the data, making it easier to interpret.
- **[10:28.60–10:31.14]** And these small changes all make a huge difference
- **[10:31.14–10:34.44]** and are much more interesting than simple unstyled text.
- **[10:36.26–10:38.04]** Okay, before we wrap up here,
- **[10:38.30–10:41.10]** let's just give this design a few final touches.
- **[10:41.70–10:44.54]** Now, going back to our tip about using fewer borders.
- **[10:44.98–10:47.76]** We also have a lot of borders around these containers,
- **[10:47.82–10:50.20]** making the page look busier than it needs to be.
- **[10:50.72–10:53.38]** A better way to distinguish them from the background
- **[10:53.38–10:55.74]** is making the background off-white.
- **[10:56.14–10:58.82]** This also helps them pop off the page a bit more.
- **[11:00.70–11:03.26]** And just to give them a little bit more pop,
- **[11:03.42–11:05.98]** we're going to add a subtle shadow to them.
- **[11:06.36–11:08.02]** Now, when adding a box shadow,
- **[11:08.12–11:10.92]** instead of just using large blur and spread values
- **[11:10.92–11:12.98]** to make the box shadows even more noticeable,
- **[11:13.34–11:14.64]** add a vertical offset.
- **[11:15.02–11:16.70]** This looks much more natural
- **[11:16.70–11:19.94]** because it simulates a light source shining down from above,
- **[11:20.14–11:21.86]** just like we're used to seeing in the real world.
- **[11:23.38–11:25.96]** And speaking of natural, let's talk about the grays.
- **[11:26.22–11:30.54]** So, at the moment, this design has pure, fully desaturated grays,
- **[11:30.70–11:33.12]** making it feel dull and unnaturally,
- **[11:33.16–11:36.00]** especially when mixed with some of the other colors on the page.
- **[11:36.42–11:39.48]** So, we're going to saturate them with a bit of blue.
- **[11:40.04–11:42.48]** This changes the overall temperature of the design,
- **[11:42.60–11:44.12]** giving it more of a cooler feel.
- **[11:47.74–11:49.74]** Finally, let's update the font choice.
- **[11:49.98–11:51.10]** So, at the moment,
- **[11:51.10–11:53.76]** this design is using the system font stack.
- **[11:54.00–11:55.60]** So, in this case, San Francisco,
- **[11:55.90–11:57.90]** which is Apple's system default font.
- **[11:58.28–12:00.62]** San Francisco is a great font,
- **[12:00.80–12:03.94]** but we want to find something that has a little more character
- **[12:03.94–12:05.56]** and isn't going to change
- **[12:05.56–12:08.10]** depending on the operating system that you're using.
- **[12:09.10–12:11.40]** So, let's head over to Google Fonts.
- **[12:11.60–12:13.28]** Now, we all love Google Fonts.
- **[12:13.28–12:16.60]** It's probably the best resource on the web for free fonts.
- **[12:17.10–12:19.82]** But with that, there's a lot to choose from,
- **[12:19.98–12:23.30]** and most of the fonts on there are poor choices for UIs.
- **[12:24.06–12:26.00]** So, if you're going to use Google Fonts
- **[12:26.00–12:27.26]** and just want something reliable,
- **[12:27.56–12:28.90]** head over to the sidebar
- **[12:28.90–12:30.96]** and tweak the settings as you see here.
- **[12:31.24–12:32.86]** So, let's start with the classification.
- **[12:33.78–12:36.68]** So, serifs can be a bit distracting on application UIs.
- **[12:36.68–12:39.68]** So, a sans serif is usually a better choice.
- **[12:40.50–12:42.48]** And sort by the most popular ones,
- **[12:42.66–12:45.30]** so the best options appear at the top of the list.
- **[12:45.94–12:48.42]** And I'd recommend a font with eight weights.
- **[12:48.70–12:51.94]** This will at least give you a regular, bold,
- **[12:52.34–12:54.14]** a lightweight, a semi-bold,
- **[12:54.38–12:55.98]** plus all of the italics.
- **[12:56.48–12:59.76]** That doesn't necessarily mean you need to use all of the weights,
- **[12:59.92–13:02.98]** but it's usually a good indicator of a quality font
- **[13:02.98–13:04.26]** when it has all of these.
- **[13:05.10–13:08.44]** And this is going to give you a decent list of safe choices.
- **[13:09.32–13:11.34]** Alternatively, if you have a budget,
- **[13:11.60–13:13.84]** I recommend using a service like Typekit,
- **[13:14.02–13:16.28]** fonts.com, or Hefler Fonts.
- **[13:16.46–13:18.14]** These are all great services
- **[13:18.14–13:21.04]** and allow you to use even more high-quality fonts
- **[13:21.04–13:22.52]** at a fair monthly price.
- **[13:23.08–13:24.66]** And much like Google Fonts,
- **[13:24.90–13:27.12]** Typekit has a similar panel on the left
- **[13:27.12–13:28.76]** where you can filter the results.
- **[13:29.06–13:33.12]** So again, starting with a sans serif for the classification,
- **[13:34.26–13:36.00]** we also have a few more choices here.
- **[13:36.26–13:38.10]** So you're going to want something
- **[13:38.10–13:40.54]** that's legible at small paragraph sizes.
- **[13:41.18–13:43.26]** You also want a font that's neutral
- **[13:43.26–13:45.34]** when it comes to weight and width.
- **[13:46.24–13:47.74]** Fonts with a large X height
- **[13:47.74–13:50.28]** are always easier to read on screens.
- **[13:50.58–13:51.66]** And then with that,
- **[13:51.84–13:54.48]** you get a much less overwhelming list of options.
- **[13:55.60–13:56.76]** And in that list,
- **[13:56.90–13:58.12]** we get one of my favorite fonts,
- **[13:58.28–13:59.04]** Proxima Nova.
- **[13:59.36–14:01.06]** It just looks great on screens.
- **[14:01.38–14:02.48]** It's super legible,
- **[14:02.78–14:03.42]** really versatile,
- **[14:03.90–14:05.28]** and it just looks clean.
- **[14:05.30–14:07.36]** So we're going to apply this to the design.
- **[14:12.14–14:14.80]** Okay, so this all looks great on a large screen,
- **[14:14.98–14:17.66]** but how does this translate to mobile devices?
- **[14:18.44–14:21.34]** Well, because we designed the page on a 12 column grid,
- **[14:21.66–14:24.90]** the easy thing to do is stack all the major elements.
- **[14:25.44–14:27.40]** Now, this might be a good starting point,
- **[14:27.54–14:30.12]** but it does create an excessive amount of scrolling
- **[14:30.12–14:31.40]** just to get past the header.
- **[14:31.70–14:34.68]** So maybe there's a way to organize this information
- **[14:34.68–14:37.06]** that is better optimized for mobile devices.
- **[14:37.96–14:39.36]** Let's start with the navigation.
- **[14:39.68–14:41.38]** So a common approach you can use
- **[14:41.38–14:44.64]** to contain complex navigation like this on a mobile device
- **[14:44.64–14:46.52]** is by using the menu button,
- **[14:46.80–14:48.60]** also known as the hamburger menu.
- **[14:49.16–14:51.60]** It works great on an application like this
- **[14:51.60–14:52.98]** where the users are more likely
- **[14:52.98–14:54.62]** to visit the mobile experience
- **[14:54.62–14:56.38]** just to get an overview of things
- **[14:56.38–14:59.12]** and leave the creation process to the desktop.
- **[15:00.20–15:01.94]** But what about the overview section?
- **[15:02.44–15:05.34]** Although this stacks a bit nicer than the navigation,
- **[15:05.70–15:07.88]** it takes up quite a bit of vertical space.
- **[15:08.12–15:10.18]** So maybe we can present this information
- **[15:10.18–15:11.74]** in a more condensed way.
- **[15:12.46–15:14.52]** Well, we don't want to rearrange the text
- **[15:14.64–15:16.36]** in such a way that ruins the hierarchy
- **[15:16.36–15:17.14]** that we've established,
- **[15:17.44–15:20.44]** but maybe we could better utilize the horizontal space
- **[15:20.44–15:23.42]** by moving the view all button to the right side
- **[15:23.42–15:26.24]** and effectively reducing our vertical space.
- **[15:28.30–15:30.10]** And as for the recent invoices,
- **[15:30.38–15:32.34]** there's not much we need to change here
- **[15:32.34–15:35.98]** as the cards adapt quite nicely to the smaller viewport.
- **[15:37.28–15:38.62]** Okay, what about the table?
- **[15:38.94–15:41.40]** Tables are a bit trickier on smaller devices.
- **[15:41.40–15:43.66]** The easiest thing to do would be
- **[15:43.66–15:45.18]** to give it horizontal scrolling.
- **[15:45.64–15:46.88]** Now, when you're doing this,
- **[15:47.06–15:49.14]** make sure to provide some indicator
- **[15:49.14–15:51.42]** that there is more information beyond the screen,
- **[15:51.72–15:53.80]** even if it's just cutting off the text a bit.
- **[15:54.48–15:56.16]** However, on a page like this
- **[15:56.16–15:58.34]** intended to just give users an overview,
- **[15:58.64–16:00.02]** it might be more acceptable
- **[16:00.02–16:02.44]** to reduce the amount of information presented.
- **[16:02.78–16:05.12]** For example, the dates associated
- **[16:05.12–16:07.08]** with these invoices are important,
- **[16:07.08–16:08.80]** and when given the real estate,
- **[16:09.00–16:10.44]** they should certainly be considered.
- **[16:11.06–16:13.82]** But data like the name, amount, and status
- **[16:13.82–16:15.64]** contain much more information for the user
- **[16:15.64–16:17.12]** to create a full understanding.
- **[16:17.84–16:18.86]** So let me explain.
- **[16:19.12–16:21.06]** The name acts as an identifier.
- **[16:21.46–16:24.22]** And with that, the user can immediately recollect
- **[16:24.22–16:25.78]** on their relationship with the client
- **[16:25.78–16:27.10]** and the final transaction.
- **[16:27.64–16:29.74]** And the amount is the value of the user
- **[16:29.74–16:31.36]** is probably the most concerned with.
- **[16:31.48–16:33.92]** And by just providing the visual indicators
- **[16:33.92–16:35.76]** for the higher severity transactions,
- **[16:36.12–16:38.58]** it will alert the user to dig deeper
- **[16:38.58–16:40.62]** by clicking through to take a closer look
- **[16:40.62–16:41.36]** at those dates.
- **[16:41.88–16:44.46]** And by reducing the amount of information presented,
- **[16:44.74–16:46.64]** we're able to fit everything nicely
- **[16:46.64–16:48.24]** on this small screen size.
- **[16:51.18–16:53.10]** Okay, that pretty much wraps everything up.
- **[16:53.22–16:54.92]** So let's just compare this design
- **[16:54.92–16:56.48]** to the one we started with.

## Ending coverage

The last accepted narration segment ends at 16:56.48. The remaining 23.4986875 seconds are a closing comparison/outro interval, not omitted input. Isolated local re-decodes produced no stable narration there. Suspected tail hallucinations are retained separately in the JSON rather than presented as speech.
