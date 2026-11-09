# Choose a practical type scale

## Apply this

- If many nearly identical sizes accumulate, select a small shared type scale.
- Use practical explicit sizes instead of blindly following a mathematical ratio.
- Check component nesting and zoom; avoid relative sizing that unintentionally compounds.

## Source

Source: `Refactoring UI v1.0.2.pdf`, version 1.0.2, PDF pages 87–93.
Apply this is new guidance; the source blocks below preserve the supplied pypdf extraction verbatim.
Page images preserve the original visual content, including text absent from extraction.

### Source outline

- Designing Text (source page 87)
- Establish a type scale (source page 88)
  - Choosing a scale (source page 89)
    - Modular scales (source page 89)
    - You end up with fractional values. (source page 90)
    - You usually need more sizes. (source page 90)
    - Hand-crafted scales (source page 90)
  - Avoid em units (source page 92)

## Source pages

### Source page 87

![Source PDF page 87](../assets/book-page-087.jpg)

```text
Designing Text
```

### Source page 88

![Source PDF page 88](../assets/book-page-088.jpg)

```text
Establish a type scale
Most interfaces use way too many font sizes. Unless a team has a rigid
design system in place, it’s not uncommon to find that every pixel value from
10px to 24px has been used in the UIsomewhere.
Choosing font sizes without a system is a bad idea for two reasons:
1. It leads to annoying inconsistencies in your designs.
2. It slows down your workflow.
So how do you define a type system?
```

### Source page 89

![Source PDF page 89](../assets/book-page-089.jpg)

```text
Choosing a scale
Just like with spacing and sizing,a linear scale won’t work. Smaller jumps
between font sizes are useful at the bottom of the scale, but you don’t want
to waste time deciding between 46px and 48px for a large headline.
Modular scales
One approach is to calculate your type scale using aratio, like 4:5(a “major
third”), 2:3(a “perfect fifth”), or perhaps the “golden ratio”, 1:1.618. This is
often called a “modular scale”.
You start with a sensible base value(16px is common since it’s the default
font size for most browsers), apply your ratio to get the next value, then
apply your ratio tothat value to get the next value, and so on and so forth:
Establish a type scale 89
```

### Source page 90

![Source PDF page 90](../assets/book-page-090.jpg)

```text
The mathematical purity of this approach is alluring, but in practice, it’s not
perfect for a couple of reasons.
1. You end up with fractional values.
Using a 16px base and 4:5 ratio, your scale will end up with lots of sizes
that don’t land right on the pixel, like 31.25px, 39.063px, 48.828px, etc.
Browsers all handle subpixel rounding a little bit differently, so it’s best to
avoid fractional sizes if you can avoid it.
If you do want to use this approach, make sure you round the values
yourself when defining the scale to avoid off-by-one pixel issues across
browsers.
2. You usually need more sizes.
This approach can work well if you’re defining a type scale for long form
content like an article, but for interface design, the jumps you get using
a modular scale are often a bittoo limiting.
With a(rounded) 3:4 type scale, you get sizes like 12px, 16px, 21px, and
28px. While this might not seem too limiting on the surface, in practice
you’re going to wish you had a size between 12px and 16px, and another
between 16px and 21px.
You could use a tighter ratio like 8:9, but at this point you’re just trying to
pick a scale that happens to match the sizes you already know you want.
Hand-crafted scales
For interface design, a more practical approach is to simply pick values by
hand. You don’t have to worry about subpixel rounding errors this way, and
you have total control over which sizes exist instead of outsourcing that job
to some mathematical formula.
Establish a type scale 90
```

### Source page 91

![Source PDF page 91](../assets/book-page-091.jpg)

```text
Here’s an example of a scale that works well for most projects and aligns
nicely with the spacing and sizing scale recommended in“Establishing a
spacing and sizing system”:
It’s constrained just enough to speed up your decision making, but isn’t so
limited as to make you feel like you’re missing a useful size.
Establish a type scale 91
```

### Source page 92

![Source PDF page 92](../assets/book-page-092.jpg)

```text
Avoid em units
When you’re building a type scale, don’t useem units to define your sizes.
Becauseem units are relative to the current font size, the computed font size
of nested elements is often not actually a value in your scale.
For example, say you’ve defined an em-based type scale like this:
Establish a type scale 92
```

### Source page 93

![Source PDF page 93](../assets/book-page-093.jpg)

```text
If you give an element a font size of 1.25em(20px by default), inside of that
element 1em is now equal to 20px. That means that if you give one of the
nested elements a font size of .875em, the actual computed font size is
17.5px, not a value from your type scale!
Stick topx orrem units — it’s the only way to guarantee you’re actually
sticking to the system.
Establish a type scale 93
```
