# Use shadows as an elevation scale

## Apply this

- If surfaces seem randomly layered, define a small elevation hierarchy.
- Assign larger, softer shadows to higher surfaces and connect elevation to interaction where useful.
- Check menus, cards, and dialogs together; every surface does not need a shadow.

## Source

Source: `Refactoring UI v1.0.2.pdf`, version 1.0.2, PDF pages 158–162.
Apply this is new guidance; the source blocks below preserve the supplied pypdf extraction verbatim.
Page images preserve the original visual content, including text absent from extraction.

### Source outline

- Use shadows to convey elevation (source page 158)
  - Establishing an elevation system (source page 160)
  - Combining shadows with interaction (source page 161)

## Source pages

### Source page 158

![Source PDF page 158](../assets/book-page-158.jpg)

```text
Use shadows to convey elevation
Shadows can be more than just a flashy effect — used thoughtfully, they let
you position elements on a virtual z-axis to create a meaningful sense of
depth.
Small shadows with a tight blur radius make an element feel only slightly
raised off of the background, while larger shadows with a higher blur radius
make an element feel much closer to the user:
The closer something feels to the user, the more it will attract their focus.
```

### Source page 159

![Source PDF page 159](../assets/book-page-159.jpg)

```text
You might use a smaller shadow for something like a button, where you want
the user to notice it but don’t want it to dominate the page:
Medium shadows are useful for things like dropdowns; elements that need
to sit a bit further above the rest of the UI:
Use shadows to convey elevation 159
```

### Source page 160

![Source PDF page 160](../assets/book-page-160.jpg)

```text
Large shadows are great for modal dialogs, where you really want to capture
the user’s attention:
Establishing an elevation system
Just like with color, typography, spacing, and sizing, defining a fixed set of
shadows will speed up your workflow and help maintain consistency in your
designs.
You don’t need a ton of different shadows — five options is usually plenty.
Use shadows to convey elevation 160
```

### Source page 161

![Source PDF page 161](../assets/book-page-161.jpg)

```text
Start by defining your smallest shadow and your largest shadow, then fill in
the middle with shadows that increase in size pretty linearly:
Combining shadows with interaction
Shadows aren’t only useful for positioning elements on the z-axis statically;
they’re a great way to provide visual cues to the user as they interact with
elements, too.
For example, say you had a list of items where the user could click and drag
each item to sort them. Adding a shadow to an item when a user clicks it
makes it feel like it pops forward above the other items in the list, and makes
it clear to the user that they can drag it:
Use shadows to convey elevation 161
```

### Source page 162

![Source PDF page 162](../assets/book-page-162.jpg)

```text
Similarly, you can make a button feel like it’s being pressed into the page
when a user clicks it by switching to a smaller shadow, or perhaps removing
the shadow altogether:
Using shadows in a meaningful way like this is a great way to hack the
process of choosing what sort of shadow an element should have. Don’t
think about the shadow itself, think about where you want the element to sit
on the z-axis and assign it a shadow accordingly.
Use shadows to convey elevation 162
```
