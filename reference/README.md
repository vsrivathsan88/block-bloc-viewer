# reference photos

`roomplanner.html`'s **Compare** mode looks for the five source photos here, by
these exact names:

| file | view |
|------|------|
| `01-kitchen-island.jpg` | from the kitchen island, looking east across the island toward the media console |
| `02-living-console.jpg` | living room, looking east at the media console + balcony door |
| `03-living-stair.jpg`   | from the island, looking south at the living room + staircase |
| `04-kitchen-wide.jpg`   | from the great room, looking north at the kitchen |
| `05-dining-nook.jpg`    | the dining nook |

Drop the JPGs in with those names and Compare lights up: each numbered button
jumps the camera to that photo's estimated pose and overlays the photo on the
render, with a slider to blink between them. That's the fastest way to check
the reconstruction against the pixels — and to correct it, since anything that
doesn't line up can be dragged into place in Plan mode.

Any format the browser can decode works; rename to `.jpg` or edit the `file`
fields under `cameras` in `schemas/great-room.json`.

Without these files everything else still works. The camera poses are stored in
the schema, so the numbered buttons still fly to each viewpoint — you just get
the model on its own with nothing to compare against.

## About the poses

They were solved by hand, not by feature matching: five wide-baseline shots of
a beige, texture-poor interior is close to the worst case for structure-from-
motion. Instead the room's own rectilinear geometry fixed the axes, and objects
appearing in more than one frame fixed the relative positions — chiefly the
cherry media console, which shows up in views 01, 02 and 05. Metric scale comes
from standard fixture sizes (0.92 m counter, 2.03 m door, 0.91 m fridge).

Expect the poses to be close but not exact. They are a starting point for the
overlay, not a calibration result.
