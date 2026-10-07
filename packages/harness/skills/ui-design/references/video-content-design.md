# Content design — timestamped narration

## Apply this

Read this when refining content-heavy pages. Constrain the reading column, distinguish heading and body roles, group lists and testimonials, and verify the narrow layout with real copy.

> Automated local English transcription, not a manually verified verbatim transcript. Recognition and timing errors may remain. This is narration, not a summary.

- Source: `Designing Content v1.0.1.mp4`.
- Video duration: 12:08.45 (728.45 seconds); extracted audio: 728.4480000 seconds.
- Primary model: `mlx-community/whisper-large-v3-turbo`; independent checks: `mlx-community/whisper-large-v3-mlx`.
- [Complete segment/word JSON with confidence fields](../assets/video-content-design.json).
- [Validation and coverage report](video-transcription-quality.md).

## Recognition caveats

- At 02:00–02:13, spoken CSS unit names are normalized to em; the raw model wording remains in JSON.
- At 08:17, the font name is recognized as Graphic by both models; the precise proper-name spelling remains uncertain.
- At 09:21, the recognized phrase entire background white is contextually ambiguous; it is preserved, not silently rewritten.

## Visual references

Frames are JPEG, 1280 × 720, captured at the indicated source-video times. Captions were checked against the extracted images.

- [00:05 — Content lesson title card](../assets/video-content-design-00-05.jpg)
- [00:30 — Initial FutureWeb page with wide paragraphs](../assets/video-content-design-00-30.jpg)
- [01:52 — Narrowed body-copy column](../assets/video-content-design-01-52.jpg)
- [02:58 — Headline and body line-height annotations](../assets/video-content-design-02-58.jpg)
- [04:30 — Lighter headline with differentiated body text](../assets/video-content-design-04-30.jpg)
- [05:34 — List and quote spacing in the editor](../assets/video-content-design-05-34.jpg)
- [06:06 — Checkmark icons replacing list bullets](../assets/video-content-design-06-06.jpg)
- [07:30 — Italic testimonial with portrait and attribution](../assets/video-content-design-07-30.jpg)
- [08:30 — Updated content typography and testimonial](../assets/video-content-design-08-30.jpg)
- [09:52 — Email input against the subtly tinted background](../assets/video-content-design-09-52.jpg)
- [10:52 — Colored top accent border](../assets/video-content-design-10-52.jpg)
- [11:37 — Narrow layout with stacked email input and button](../assets/video-content-design-11-37.jpg)
- [11:58 — Closing comparison view of the list and testimonial](../assets/video-content-design-11-58.jpg)

## Narration

- **[00:00.00–00:04.70]** Hey everyone, in this video we're going to be taking a look at a text-heavy UI.
- **[00:05.02–00:12.00]** Now the primary goal of this video will be to help you make better decisions with page hierarchy, formatting, and layout when working with text.
- **[00:12.50–00:18.82]** And for this example, we're going to be taking a look at this hype page for a fictional conference called FutureWeb.
- **[00:18.96–00:23.62]** It's a conference that explores the latest tools and technology in web development.
- **[00:24.38–00:27.72]** Before we get into it, let's just break this page down a bit.
- **[00:27.72–00:33.36]** Now there's nothing special here. We have a strong title with some information like the date and location.
- **[00:33.64–00:37.14]** We have two paragraphs that outline the type of conference it is.
- **[00:37.40–00:40.44]** We have some bullet points addressing who the target audience is.
- **[00:40.68–00:43.50]** We have a testimonial from a previous attendee.
- **[00:43.96–00:46.44]** And then finally we have an input group to collect emails.
- **[00:46.86–00:53.14]** And content-wise, this is just a great way to get something up quickly to start generating emails and hype about the conference.
- **[00:53.86–00:56.66]** But at the moment, it's a bit uninspiring visually.
- **[00:57.72–00:59.34]** We're actually just using bootstrap defaults.
- **[00:59.40–01:01.70]** So there's a lot of quick wins that can be made here.
- **[01:02.20–01:07.58]** Now whether you're styling text on a marketing page or in an article or even in documentation,
- **[01:08.08–01:10.94]** it's important to make the act of reading effortless for the user.
- **[01:11.40–01:16.42]** And one of the most common mistakes I see being made is zero consideration for the line length.
- **[01:16.58–01:21.18]** For some reason, there's this desire to fill the entire page so there's no awkward white space.
- **[01:21.74–01:29.50]** And this can be problematic because in most cases, a page width is far too wide, making it difficult to track your progress while reading.
- **[01:29.84–01:37.72]** The last thing you want is users skipping lines or even rereading lines of text because their eye has too far to travel to get to the beginning of the next line.
- **[01:38.78–01:45.10]** For the best reading experience, make your paragraphs wide enough to fit between 45 and 75 characters.
- **[01:45.64–01:53.24]** And by reducing the line length, not only does it make a big difference in legibility, but it also gives you a more professional looking layout.
- **[01:54.34–01:57.92]** Line length isn't the only factor in getting an optimal reading width.
- **[01:57.92–02:00.72]** You can also increase the font size to get the right balance.
- **[02:00.96–02:08.80]** The easiest way to achieve balance with line length and font size on the web is by using em units, which are relative to the font size of the element.
- **[02:09.18–02:13.24]** The sweet spot is a width somewhere between 20 and 35 em.
- **[02:14.08–02:18.18]** Now, line length and font size aren't the only way to improve legibility.
- **[02:18.48–02:21.24]** Another way to enhance the reading experience is space.
- **[02:21.52–02:24.24]** This can be introduced by increasing the line height.
- **[02:24.86–02:32.72]** So again, if you've ever accidentally read the same line of text twice or even skipped a line, it probably means that the line height was too short.
- **[02:32.96–02:37.80]** For body copy, a good safe call is anywhere from 1.4 to 1.7.
- **[02:38.20–02:42.46]** But using the same line height for all text is a very subtle but common mistake.
- **[02:42.92–02:48.18]** A larger line height may work great for body copy, but as text gets larger, your line height should get tighter.
- **[02:48.18–02:54.74]** You see, when text is a smaller size, the extra space is helpful because it makes it easier when jumping to the next line.
- **[02:55.00–03:00.18]** But as it grows, it becomes less of an issue, and you may not need any extra line spacing at all.
- **[03:00.90–03:04.72]** Now, at the moment, the hierarchy is established using font size alone.
- **[03:05.12–03:09.92]** But font size isn't always the best way to emphasize or de-emphasize text.
- **[03:09.92–03:14.44]** If text is important, like these titles here, try making it bolder.
- **[03:14.78–03:19.44]** If text is secondary, like the body copy, try making it a lighter color.
- **[03:19.76–03:21.88]** This makes the page much more skimmable.
- **[03:23.78–03:26.18]** You can probably get away with using three colors.
- **[03:26.48–03:29.50]** For primary content like headlines, you can use dark text.
- **[03:29.68–03:34.32]** For secondary content like body copy or metadata, you can use gray.
- **[03:34.32–03:41.86]** And finally, for lower priority content, maybe like legal jargon or placeholder text, you can use a lighter but still accessible gray.
- **[03:42.54–03:50.70]** And I say three colors because any more will be difficult to create a large enough distinction while still maintaining a high enough contrast ratio to be accessible.
- **[03:51.76–03:55.96]** Okay, so for this page title, we can probably use a display font.
- **[03:56.42–04:01.10]** Now, some high quality fonts come with weights ranging from ultra light to black.
- **[04:01.66–04:09.54]** These weights are not ideal for body copy as they become very illegible at small sizes, but they do work great for headlines like this.
- **[04:10.24–04:15.52]** Now, deciding whether to go with a lightweight or a heavyweight depends on the voice you're trying to achieve.
- **[04:15.98–04:22.72]** A lightweight can appear more elegant and sophisticated, while heavier weights can come across as more tough and exuberant.
- **[04:23.34–04:29.84]** So for this particular example, we're going to go with the lightweight because we want to keep the design looking clean and minimal.
- **[04:31.10–04:36.50]** Now that we've adjusted the font sizes and changed the color, we still managed to maintain a clear hierarchy.
- **[04:37.30–04:44.86]** But even though it's clear what is important versus what is less important, the relationships between the content is still a little unclear.
- **[04:45.30–04:51.54]** At the moment, these titles share an equal distance with the content above them as well as the content below them.
- **[04:51.54–04:56.42]** So we need to consider proximity to understand what information is associated with each other.
- **[04:57.04–05:03.48]** For example, in this case, we want the conference date and location to be attached to the page title, not the body.
- **[05:03.86–05:10.48]** And the title for who this conference is for should probably be attached to the content that outlines who this conference is for.
- **[05:10.86–05:13.82]** So we're going to use liberal spacing so it's much clearer.
- **[05:14.72–05:18.72]** And this principle is also applicable to the bulleted list at the bottom.
- **[05:19.32–05:26.56]** Far too often, I see that the distance between each list item is the same as the line height, so the bullet points become less skimmable.
- **[05:26.94–05:32.54]** For lists, I recommend making the space between each point about twice the size of the font size.
- **[05:35.56–05:43.00]** So this design is looking much cleaner already, but we're going to see if there's a few things we can do to make this look a bit more interesting.
- **[05:43.44–05:46.06]** To start, let's look at this unordered list.
- **[05:46.46–05:48.40]** These bullet points are sort of boring.
- **[05:48.70–05:53.88]** An easy way to make this look more interesting is to replace the bullets with generic icons.
- **[05:54.42–05:57.70]** Something like an arrow or a checkmark will be perfect for this.
- **[05:57.70–06:04.46]** And if you're working with a large set of icons, you can even mix it up and make the icons relevant to the text they're associated with.
- **[06:05.12–06:07.08]** Okay, that's looking much more interesting.
- **[06:07.32–06:08.72]** So let's see what else we can do.
- **[06:09.30–06:11.16]** Let's take a look at this block quote.
- **[06:11.54–06:17.76]** Aside from the larger font size and the actual quotes around it, it more or less looks like a boring block of text.
- **[06:18.42–06:22.38]** Because it's a quote, it would be nice to find a way to change the voice of it.
- **[06:22.82–06:25.62]** Now one way we can do that is to change the font.
- **[06:25.62–06:28.20]** So we're going to update it to a serif font.
- **[06:29.22–06:35.34]** Serifs can come across as being more formal and as a result more trustworthy, which is great for using on a quote.
- **[06:35.72–06:38.98]** In this case, I'm using Georgia, which is a web safe font.
- **[06:39.40–06:43.40]** And it does a really good job at differentiating it from the rest of the text.
- **[06:44.08–06:48.42]** And in addition to changing the typeface, we're also going to italicize it.
- **[06:48.68–06:53.78]** This gives it much more of a conversational tone and makes it feel a little bit more authentic.
- **[06:55.62–06:57.26]** So that looks like an improvement.
- **[06:57.40–07:05.22]** But a much nicer way to make these quotes more interesting is to use them as a visual element instead of just wrapping the text in them.
- **[07:05.62–07:15.08]** By simply increasing the size, adding color, and offsetting it a bit, we have something that's a little bit more interesting on the page and makes the quote much more unambiguous.
- **[07:16.78–07:20.44]** Finally, let's add an image to the name to give it a little bit more authenticity.
- **[07:20.98–07:25.34]** And we're going to give the name a little more emphasis by bolding it and applying the brand color.
- **[07:26.06–07:29.20]** Let's also stack the details to fill the space a bit better.
- **[07:29.42–07:32.12]** This makes it easier to take it in at a glance.
- **[07:34.22–07:40.20]** Now, since this video focuses heavily on typography, it would be silly not to address the typeface.
- **[07:40.56–07:44.80]** Now, at the moment, we're using San Francisco, which is Apple's system default font.
- **[07:45.16–07:52.50]** It's a beautiful font, but we want something that's not as widely used and is not going to change depending on the operating system you're using.
- **[07:53.26–07:56.98]** Now, an easy method for finding a good font is to steal them.
- **[07:57.40–08:04.22]** So oftentimes, when I find a new site that I like, the first thing I do is open the developer tools and see what fonts are being used.
- **[08:04.58–08:06.58]** This is how I learn about new fonts.
- **[08:06.70–08:11.76]** And after doing this for a few years, I'm now able to identify most fonts without even checking.
- **[08:12.16–08:16.06]** So it's a really good habit to get into and start learning about new fonts.
- **[08:16.90–08:21.82]** For example, I recently stumbled across this font called Graphic that I've been using for a few projects.
- **[08:22.50–08:25.38]** It's super clean, versatile, and it has a ton of different weights.
- **[08:25.70–08:27.56]** All the criteria I look for in a good font.
- **[08:31.92–08:36.42]** Now, when you're updating your font, keep in mind that all fonts are not transferable,
- **[08:36.64–08:39.72]** meaning you may need to adjust the size and weights.
- **[08:40.40–08:46.80]** Sometimes a bold weight of one font may be too bold on another, so you may want to try a semi-bold weight.
- **[08:48.18–08:49.26]** Okay, moving on.
- **[08:49.44–08:52.04]** We really want this input to stand out on the page.
- **[08:52.50–08:54.16]** So we're going to do a few things to it.
- **[08:54.54–08:57.16]** First, let's increase the size of the input.
- **[08:57.68–09:01.74]** Because it's the only action on the page, we really want it to be clear as possible.
- **[09:11.70–09:17.14]** And because it's white against a white background, it doesn't stand out as much as we want.
- **[09:17.30–09:20.70]** So a quick fix to this is to make the background an off-white.
- **[09:21.10–09:25.76]** But we don't want to make the entire background white because the white looks nice at the top,
- **[09:25.76–09:27.66]** and it really helps the text pop.
- **[09:28.38–09:34.24]** Instead, a nice little trick is to make the background a gradient, where it starts as white
- **[09:34.24–09:37.18]** and becomes a subtle gray by the time you get to the input.
- **[09:38.20–09:41.58]** Additionally, let's replace the borders with a subtle shadow.
- **[09:41.86–09:45.70]** This not only makes it cleaner, but it really makes it pop off the page.
- **[09:45.70–09:50.08]** Now, when doing this, make sure to offset your shadow vertically a few pixels,
- **[09:50.26–09:52.56]** just to establish a light source coming from above.
- **[09:53.88–09:57.36]** Okay, on the note of grays, now that we've made the background an off-white,
- **[09:57.64–10:00.66]** right now we're using pure grays everywhere on the page.
- **[10:01.12–10:06.12]** Now, one trick I like to do is saturate my grays to change the overall temperature of the site.
- **[10:06.60–10:11.24]** Now, when doing this, the trick is to increase the saturation as the grays get darker.
- **[10:11.24–10:14.66]** So, on an HSB picker, it might look something like this.
- **[10:17.54–10:21.18]** Okay, so you may have noticed that this is a text-heavy site,
- **[10:21.34–10:25.48]** and it lacks beautiful photography and colorful illustrations.
- **[10:25.82–10:27.76]** So, it looks a bit bland.
- **[10:28.22–10:33.78]** One simple trick to add a dash of visual flair is by adding colorful accent borders.
- **[10:34.06–10:40.22]** For example, in this case, I'm going to add a 6-pixel border across the top of the entire site.
- **[10:41.24–10:47.30]** This trick is great because it doesn't take any graphic design talent to add a colored rectangle to your UI,
- **[10:47.70–10:51.18]** but it can go a long way in making your site feel more designed.
- **[10:51.82–10:55.38]** This trick also works great on modals, cards, and alerts.
- **[10:57.58–10:59.78]** Okay, so that pretty much wraps everything up.
- **[11:00.16–11:02.24]** Fortunately, for a simple page like this,
- **[11:02.40–11:06.64]** you don't need to make any major structural changes to have it work on mobile devices.
- **[11:07.38–11:09.96]** But make sure you scale your font size accordingly.
- **[11:10.62–11:15.72]** Just because you have a headline that's 2.5 times the size of your 18-pixel font on desktop,
- **[11:16.06–11:21.30]** doesn't mean you should make the headline 2.5 times the size of your 14-pixel font on mobile.
- **[11:21.56–11:25.08]** That would just result in a headline that's way too big for a small screen.
- **[11:25.76–11:29.48]** It's okay if your headline is a less extreme size on small screens.
- **[11:29.76–11:31.70]** At least it's not wrapping excessively.
- **[11:32.26–11:36.94]** Now, if necessary, stack elements like input groups to avoid squish components.
- **[11:39.50–11:40.34]** Okay, great.
- **[11:40.58–11:43.90]** So let's just compare this new design to the one we started with.

## Ending coverage

The last accepted narration segment ends at 11:43.90. The remaining 24.5480000 seconds are a closing comparison/outro interval, not omitted input. Isolated local re-decodes produced no stable narration there. Suspected tail hallucinations are retained separately in the JSON rather than presented as speech.
