# Establish a spacing and sizing scale

## Apply this

- If gaps vary arbitrarily, replace one-off values with a small non-linear scale.
- Keep finer increments at small sizes and wider steps at larger sizes.
- Apply the scale to several components and check grouping before adding exceptions.

## Source

Source: `Refactoring UI v1.0.2.pdf`, version 1.0.2, PDF pages 60–64.
Apply this is new guidance; the source blocks below preserve the supplied pypdf extraction verbatim.
Page images preserve the original visual content, including text absent from extraction.

### Source outline

- Establish a spacing and sizing system (source page 60)
  - A linear scale won’t work (source page 61)
  - Defining the system (source page 62)
  - Using the system (source page 63)

## Source pages

### Source page 60

![Source PDF page 60](../assets/book-page-060.jpg)

```text
Establish a spacing and sizing
system
You shouldn’t be nitpicking between 120px and 125px when trying to decide
on the perfect size for an element in your UI.
Painfully trialing arbitrary values one pixel at a time will drastically slow you
down at best, and create ugly, inconsistent designs at worst.
Instead, limit yourself to a constrained set of values, defined in advance.
```

### Source page 61

![Source PDF page 61](../assets/book-page-061.jpg)

```text
A linear scale won’t work
Creating a spacing and sizing system isn’t quite as simple as something like
“make sure everything is a multiple of 4px” — a naive approach like that
doesn’t make it any easier to choose between 120px and 125px.
For a system to be truly useful, it needs to take into consideration therelative
difference between adjacent values.
At the small end of the scale(like the size of an icon, or the padding inside a
button), a couple of pixels can make a big difference. Jumping from 12px to
16px is an increase of 33%!
But at the large end(the width of a card, or the vertical spacing in a landing
page hero), a couple of pixels is basically imperceivable. Even increasing the
width of a card from 500px to 520px is only a difference of 4%, which is
eight times less significant than the jump from 12px to 16px.
Establish a spacing and sizing system 61
```

### Source page 62

![Source PDF page 62](../assets/book-page-062.jpg)

```text
If you want your system to make sizing decisions easy, make sure no two
values in your scale are ever closer than about 25%.
Defining the system
Just like you don’t want to toil over arbitrary values when sizing an element
or fine-tuning the space between elements, you don’t want to build your
spacing and sizing scale from arbitrary values either.
A simple approach is to start with a sensiblebase value, then build a scale
using factors and multiples of that value.
16px is a great number to start with because it divides nicely, and also
happens to be the default font size in every major web browser.
Establish a spacing and sizing system 62
```

### Source page 63

![Source PDF page 63](../assets/book-page-063.jpg)

```text
The values at the small end of the scale should start pretty packed together,
and get progressively more spaced apart as you get further up the scale.
Here’s an example of a fairly practical scale built using this approach:
Using the system
Once you’ve defined your spacing and sizing system, you’ll find that you’re
able to design a hell of a lot faster, especially if you design in the browser
(sticking to a system is easier when you’re typing in numbers than when
you’re dragging with the mouse.)
Establish a spacing and sizing system 63
```

### Source page 64

![Source PDF page 64](../assets/book-page-064.jpg)

```text
Need to add some space under an element? Grab a value from your scale
and try it out. Not quite enough? The next value is probably perfect.
While the workflow improvements are probably the biggest benefit, you’ll
also start to notice a subtle consistency in your designs that wasn’t there
before, and things will look just a little bit cleaner.
A spacing and sizing system will help you create better designs, with less
effort, in less time. Design advice doesn’t get much more valuable than that.
Establish a spacing and sizing system 64
```
