# Use a consistent light source

## Apply this

- If controls look physically inconsistent, choose a shared lighting direction.
- Use restrained highlights and shadows to distinguish raised from inset surfaces.
- Check effects at normal size; avoid decorative lighting that distracts from content.

## Source

Source: `Refactoring UI v1.0.2.pdf`, version 1.0.2, PDF pages 149–157.
Apply this is new guidance; the source blocks below preserve the supplied pypdf extraction verbatim.
Page images preserve the original visual content, including text absent from extraction.

### Source outline

- Creating Depth (source page 149)
- Emulate a light source (source page 150)
  - Light comes from above (source page 151)
  - Simulating light in a user interface (source page 153)
    - Raised elements (source page 153)
    - Inset elements (source page 155)
  - Don’t get carried away (source page 157)

## Source pages

### Source page 149

![Source PDF page 149](../assets/book-page-149.jpg)

```text
Creating Depth
```

### Source page 150

![Source PDF page 150](../assets/book-page-150.jpg)

```text
Emulate a light source
Have you ever noticed how some elements in an interface feel like they’re
raised off of the page, while others feel like they are inset into the
background?
Creating this effect might look complicated at first, but it actually only
requires you to understand one fundamental rule.
```

### Source page 151

![Source PDF page 151](../assets/book-page-151.jpg)

```text
Light comes from above
Take a look at the panelling on this door:
Even though you’re just looking at a flat image, it’s still pretty obvious that
the panels on the door are raised. Why is that?
Notice how the top edge of the panel is lighter? That’s because it’s angled
towards the sky and receives more light. Similarly, the bottom edge is darker
because it’s angledaway from the sky, receivingless light.
The only way those edges could possibly be oriented that way is if the panel
itself is raised, so that’s how our brains perceive it.
Emulate a light source 151
```

### Source page 152

![Source PDF page 152](../assets/book-page-152.jpg)

```text
Now take a look at the panelling on this cabinet:
In this case it’s clear that the panels areinset because there’s a shadow at
the top indicating that the lip above is blocking the light, and the bottom
edge is lighter, indicating that it’s angled upward.
To create this same sense of depth in your designs, all you need to do is
mimic the way light affects things in the real world.
Emulate a light source 152
```

### Source page 153

![Source PDF page 153](../assets/book-page-153.jpg)

```text
Simulating light in a user interface
If you want an element to appear raised or inset, first figure out whatprofile
you want that element to have, then mimic how a light source would interact
with that shape.
Raised elements
For example, say you had a button and you wanted it to feel raised off of the
page, with perfectly flat edges on the top and bottom:
Because the top and bottom edges are both flat, it would be impossible to
see both of them at the same time. People generally look slightly downward
towards their screens, so for the most natural look, reveal a little bit of the
top edge and hide the bottom edge.
Since the top edge is facing upward, make it slightly lighter than the face of
Emulate a light source 153
```

### Source page 154

![Source PDF page 154](../assets/book-page-154.jpg)

```text
the button, usually using a top border or an inset box shadow with a slight
vertical offset:
Choose the lighter color by hand instead of using a semi-transparent white
for best results — simply overlaying white cansuck the saturationout of the
underlying color.
Next, you need to account for the fact that a raised element will block some
of the light from reaching the area below the element.
Do this by adding a small dark box shadow with a slight vertical offset(you
only want the shadow to appear below the element):
Don’t get carried away with the blur radius, a couple of pixels is plenty. These
Emulate a light source 154
```

### Source page 155

![Source PDF page 155](../assets/book-page-155.jpg)

```text
sorts of shadows should have pretty sharp edges — take a look at the
shadow cast by the bottom of a wall outlet or window frame for a real-world
example.
Inset elements
Say you’re designing a “well” component that should feel like it’s recessed
into the page.
Looking slightly downward, only the bottom lip would be visible. Since it’s
facing towards the sky, give that edge a slightly lighter color using a bottom
border or inset shadow with a negative vertical offset:
Emulate a light source 155
```

### Source page 156

![Source PDF page 156](../assets/book-page-156.jpg)

```text
The area above the well should block some of the light from reaching the
very top of the well, so add a small dark inset box shadow with a slight
positive vertical offset to make sure it doesn’t poke through at the bottom:
This same treatment works for any element that may need to appear inset,
for example text inputs and checkboxes:
Emulate a light source 156
```

### Source page 157

![Source PDF page 157](../assets/book-page-157.jpg)

```text
Don’t get carried away
Once you understand how to simulate light in an interface, it can be
tempting to tinker away for hours, tweaking and tweaking to see how closely
you can mimic the real world.
While this can be a fun exercise, in practice it can lead to interfaces that are
busy and unclear. Borrowing some visual cues from the real world is a great
way to add a bit of depth, but there’s no need to try and make things look
photo-realistic.
Emulate a light source 157
```
