# Compact presentation controls verification

Verified on Acer-1 in isolated Microsoft Edge contexts with synthetic lesson
decks. Personal browser profiles, classroom data and the original checkout
were not modified. The release base is
`3710e611c4aa7258a0964f3306a6f3ab4cfb3a6f`.

## Passed

- `npm run check`: syntax, accessibility structure, PWA/API contracts,
  reminder synchronisation and presentation-editor contracts.
- `npm run check:compact-controls`: repeated navigation, Home keyboard
  isolation, editing/dialog guards, menu keyboard/Escape/Tab/focus, narrow
  viewport bounds, sizing persistence, fullscreen escape, projector
  separation/reconnect/expansion and a warm HTTP-cache upgrade.
- `npm run check:instruction-rail`: page/deck/class switching, plain-text
  privacy, persistence/export/replace-import, both projector presentation
  paths, fullscreen recovery, actual WebM decoding and advancing playback,
  video-element fullscreen and rail restoration after exit.
- `npm run check:linked-presentation-sync`: native PowerPoint/PDF controls,
  reconnect, presentation replacement and close.
- `npm run check:projector-sync` and `npm run check:widget-startup`.
- Visual inspection of desktop fullscreen and compact viewport captures.

## Existing smoke failure

The canonical app smoke test fails at **Compact timer options should still
open** after its preceding UI sequence: the timer's `details.open` is true and
the summary has normal bounds, but its menu body measures 0 by 0. A separate,
clean checkout of the unchanged release base reproduced the same failure with
the same sequence. The minimal timer start/pause/menu flow passes on both
versions. This is recorded as an existing failure, not a passing smoke suite.
No timer implementation or redesign is included in this change.

The later main UI flow completed separately with that one known assertion
explicitly recorded instead of stopping, including saved deck restoration,
projector privacy, resource workflows and mobile controls, with no page or
console errors. This does not change the canonical test or waive its failure.

## Limits

Tests use synthetic content and an isolated browser on Acer-1. Physical
classroom hardware, school-authenticated media providers, external tabs/apps
and vendor-specific native video-player controls require classroom review.
Browser/video fullscreen cannot retain a rail owned by another fullscreen
element; exiting it restores the layout.
