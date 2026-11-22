# Stabilize contrast for text over images

## Apply this

- If image-backed text changes legibility across crops, create a controlled text surface.
- Use an overlay, reduced image contrast, colorization, or restrained text shadow as appropriate.
- Test the brightest and busiest image regions at every breakpoint; a single attractive crop is insufficient.

## Source

Source: `Refactoring UI v1.0.2.pdf`, version 1.0.2, PDF pages 176–180.
Apply this is new guidance; the source blocks below preserve the supplied pypdf extraction verbatim.
Page images preserve the original visual content, including text absent from extraction.

### Source outline

- Text needs consistent contrast (source page 176)
  - The problem with background images (source page 176)
  - Add an overlay (source page 177)
  - Lower the image contrast (source page 178)
  - Colorize the image (source page 179)
  - Add a text shadow (source page 180)

## Source pages

### Source page 176

![Source PDF page 176](../assets/book-page-176.jpg)

```text
Text needs consistent contrast
Ever tried to slap a headline on a big hero image, only to find that no matter
what color you tried for the text, it was still hard to read?
That’s because the problem isn’t the text, it’s the image.
The problem with background images
Photos can be very dynamic, with a lot of really light areas, and a lot of really
dark areas. White text might look great in the dark areas, but it gets lost in
the light areas. Dark text looks great in the light areas, but gets lost in the
dark areas.
```

### Source page 177

![Source PDF page 177](../assets/book-page-177.jpg)

```text
To solve this problem, you need toreduce the dynamics in the image to
make the contrast between the text and the background more consistent.
Add an overlay
One way to increase the overall text contrast is to add a semi-transparent
overlay to the background image.
Text needs consistent contrast 177
```

### Source page 178

![Source PDF page 178](../assets/book-page-178.jpg)

```text
A black overlay will tone down the light areas and help light text stand out,
while a white overlay will brighten up the dark areas and help dark text stand
out.
Lower the image contrast
One of the compromises you make when using an overlay is that you’re
lightening or darkening thewhole image, not just the problem areas.
If you want more control, another solution is to lower the contrast of the
image itself:
Lowering the contrast will change how light or dark the image feels overall,
so make sure to adjust the brightness to compensate.
Text needs consistent contrast 178
```

### Source page 179

![Source PDF page 179](../assets/book-page-179.jpg)

```text
Colorize the image
Another way to help text stand out against an image is to colorize the image
with a single color.
Some photo editing software includes this as a first-class feature, but if
yours doesn’t, you can create this effect in three steps:
1. Lower the image contrast, to balance things out a bit.
2. Desaturate the image, to remove any existing color.
3. Add a solid fill, using the “multiply” blend mode.
This can also be a great way to make a background image pair more nicely
with your existing brand colors.
Text needs consistent contrast 179
```

### Source page 180

![Source PDF page 180](../assets/book-page-180.jpg)

```text
Add a text shadow
If you want to preserve a bit more of the dynamics in a background image, a
text shadow can be a great way to increase contrast only where you need it
most.
You want it to look more like a subtle glow than an actual shadow, so use a
large blur radius and don’t add any kind of offset.
It’s still a good idea to reduce the overall image contrast, but combining that
with a text shadow means you can reduce it a little less.
Text needs consistent contrast 180
```
