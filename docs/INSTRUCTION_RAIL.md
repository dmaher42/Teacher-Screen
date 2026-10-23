# Persistent student instructions

Teacher Controls → Student instructions contains public Today, Now and Next text,
Show instructions, width (22–45%) and text size (20–48 px). The panel is on the
right of the media region and scrolls when the chosen text size needs more room.
Instructions save automatically with the current deck, outside page widget
snapshots. Existing decks open with empty, hidden instructions.

Present with instructions enables the panel and makes the entire student layout
fullscreen in the teacher tab. Present media only temporarily makes just the
media region fullscreen in that tab. Leaving fullscreen restores the deck's
panel setting. The paired projector keeps its synced deck setting; use Show
instructions to change it, and browser fullscreen on the projector window to
fill a second display. Its existing presentation expansion button fills the
media region beside the panel when instructions are shown.

Embedded media stays beside the rail. Native video fullscreen and separate tabs,
windows or external apps own their display and cannot retain it. This feature
adds no AI service, account or cloud storage.

## Data and projector behaviour

The optional deck-level `instructions` object contains only `visible`, `width`,
`fontSize`, `today`, `now` and `next`. Normalisation allowlists these properties,
clamps sizes, limits each text to 4,000 characters and renders via `textContent`.
Page snapshots do not contain this object. All narrowed deck persistence,
duplicate/rename, export and import projections preserve it. A missing object
always resets to empty/hidden rather than inheriting the previous deck's text.

The public projector snapshot explicitly normalises this object. The existing
private-data sanitiser and sync-token validation remain in use. Local initial
restoration and token-checked initial/reconnect/live layout updates render it
independently of widget rebuild decisions.

`student-media` contains widgets and the legacy presentation root. With the rail
visible, the legacy fixed presentation root, projector fullscreen widget and
URL viewer presentation expansion are contained by that media region. Existing
Reveal ResizeObservers and the media-region resize notification recalculate fit.
With instructions hidden, the original fullscreen sizing rules remain in use.

## Verification on Acer-1

Browser checks use new headless Microsoft Edge contexts and synthetic decks and
classes. They do not open personal profiles or access student data.

- `npm run check`: syntax, structure/accessibility contracts, PWA, AI contracts,
  Memory Cue sync, due reminders and presentation editor contracts.
- `npm run check:instruction-rail`: editor input, literal hostile text, page
  changes, deck persistence, refresh/reconnect, token rejection, public-field
  allowlisting, live width changes, legacy/embedded-video bounds at 1440×900
  and 1024×768, Replace import with the existing backup flow, Merge import
  planning, both fullscreen actions, show/hide, deck/class changes, old defaults.
  It also encodes a short synthetic WebM in-browser and checks actual decoded
  playback in the supported URL Viewer workflow on teacher and projector,
  playback beside the rail in whole-layout fullscreen, native video-element
  fullscreen via the browser Fullscreen API, rail restoration and continued
  playback after exit, and clearing the movie and instructions on a deck change.
  Embedded controls are activated with real keyboard input; no media state is
  simulated. School-authenticated providers and physical classroom hardware
  remain manual release checks.
- `npm run check:projector-sync`: existing reconnect, timers, Text Board, slide
  navigation, privacy and geometry regressions with instructions hidden.
- `npm run check:linked-presentation-sync`: synthetic Google Slides/PDF and
  PowerPoint imports, navigation, player stability, reconnect, presentation
  expansion with instructions hidden and shown, replacement, closing and
  restricted-link preservation. No browser capture prompt is introduced.
- `npm run check:widget-startup`: existing startup and minimised-widget checks.

Screenshots are generated under `output/playwright/` and kept outside the commit.
The branch is based on upstream `a4ebc1c5bf49dd95be73ecbd05b4cdf54336e311`.
The original Acer-1 checkout remains unchanged. Its earlier uncommitted source
changes were preserved separately in local commit `f808c08`; the initial tested
local variant is on `safety/tested-local-instruction-rail`. Neither is part of
the clean upstream feature branch or its PR.

## Safe release

1. Review the feature PR and test both teacher and projector windows on the
   classroom display. Check the school's real media providers, instruction text
   size, presentation expansion, and returning from native-video fullscreen.
2. Export a local Teacher Screen JSON backup before upgrading. Retain the prior
   release commit and backup. The new field is additive; an older application
   may drop it when saving a deck.
3. Rebase if main has advanced and rerun the commands above. Review the complete
   PR diff and GitHub Pages publishing configuration.
4. Merge/deploy only after Daniel explicitly approves the release. This task
   creates a draft review and does not merge or deploy.
5. After approved deployment, verify old decks stay hidden, saved instructions
   survive refresh, switching to an empty deck clears both displays, and
   projector reconnect restores the active lesson. Roll back the release commit
   if needed; restore the pre-upgrade JSON backup if deck data also needs rollback.
