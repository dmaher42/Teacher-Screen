# Persistent student instructions

In classroom view, + (Add widget) → Teacher Controls → Student instructions
contains three unlabelled public instruction fields, Show instructions and one Instruction
size selector. Compact, Standard, Large and High visibility presets adjust width
and text together. Adjust width, height and text size opens the fine controls
(22–45% width, 20–100% height, 20–48 px text). Presets adjust width and text
without resetting height. The panel overlays the top-right of the student screen;
widgets use the full screen behind it. Drag the teacher-only Move instructions
handle to reposition the panel, or focus it and use arrow keys. Home and Reset
position return it to the top-right. Shorten the panel to move it vertically.
The panel remains inside the student screen, including below fullscreen recovery
controls. Position saves with the deck and scales to the projector screen. The area below a shorter panel stays usable,
and long instructions scroll inside the chosen height. Existing decks default to
100% height. The height percentage uses the space below fullscreen recovery controls.
Instructions save automatically with the current deck, outside page widget
snapshots. Existing decks open with empty, hidden instructions.

Present with instructions enables the panel and makes the entire student layout
fullscreen in the teacher tab. Present media only temporarily makes just the
media region fullscreen in that tab. Leaving fullscreen restores the deck's
panel setting. The paired projector keeps its synced deck setting; use Show
instructions to change it, and browser fullscreen on the projector window to
fill a second display. Its existing presentation expansion button fills the
full media region beneath the panel when instructions are shown.

Both teacher presentation modes keep an Exit presentation / Home / Teacher
Controls bar inside the fullscreen surface. The bar reserves space above the
content rather than covering slides or instructions. Home leaves fullscreen
and opens the dashboard; Teacher Controls leaves fullscreen and opens the
teacher panel. Esc also exits this mode. These controls are created only by
the teacher editor and never appear in projector state or projector markup.

Presentation widgets keep the adjacent Previous/Next pair, slide selector and More visible.
More contains Edit PowerPoint when available, Open projector, projector
expansion, Close presentation and Change presentation. Use Enter/Space or
Arrow Down to open More, arrows/Home/End to move, and Escape to close it and
return focus. Tab leaves the menu. Escape closes a menu before it exits a
teacher fullscreen presentation. On very small widgets the controls wrap while
retaining accessible labels and 44px touch targets.

Slide arrow shortcuts operate on a visible presentation in classroom view,
not on Home, inside unrelated dialogs, or while editing fields. Existing
projector navigation remains separate. Versioned bootstrap, widget scripts,
the rail module import and stylesheets prevent mixed-cache upgrades from
combining new controls with old handlers.

Embedded media fills the screen beneath the rail. Native video fullscreen and separate tabs,
windows or external apps own their display and cannot retain it. This feature
adds no AI service, account or cloud storage.

## Data and projector behaviour

The optional deck-level `instructions` object contains only `visible`, `width`, `height`, `x`, `y`,
`fontSize`, `today`, `now` and `next`. Normalisation allowlists these properties,
clamps sizes, limits each text to 4,000 characters and renders via `textContent`.
Position uses 0–100% of the available horizontal/vertical travel, defaulting
to x=100, y=0 for older decks. This keeps the panel within different screen sizes.
Page snapshots do not contain this object. All narrowed deck persistence,
duplicate/rename, export and import projections preserve it. A missing object
always resets to empty/hidden rather than inheriting the previous deck's text.

The public projector snapshot explicitly normalises this object. The existing
private-data sanitiser and sync-token validation remain in use. Local initial
restoration and token-checked initial/reconnect/live layout updates render it
independently of widget rebuild decisions.

`student-media` contains widgets and the legacy presentation root. With the rail
visible, media remains full width in an isolated layer below the panel. The legacy
fixed presentation root, projector fullscreen widget and URL viewer expansion
remain contained by that media region. Existing
Reveal ResizeObservers and the media-region resize notification recalculate fit.
With instructions hidden, the original fullscreen sizing rules remain in use.

## Verification on Acer-1

Browser checks use new headless Microsoft Edge contexts and synthetic decks and
classes. They do not open personal profiles or access student data.

- `npm run check`: syntax, structure/accessibility contracts, PWA, AI contracts,
  Memory Cue sync, due reminders and presentation editor contracts.
- `npm run check:instruction-rail`: editor input, literal hostile text, page
  changes, deck persistence, refresh/reconnect, token rejection, public-field
  allowlisting, live width changes, legacy/embedded-video overlay bounds at 1440×900
  and 1024×768, Replace import with the existing backup flow, Merge import
  planning, both fullscreen actions, show/hide, deck/class changes, old defaults.
  It also checks an actual Text Board behind a half-height panel, interaction below
  it, keyboard height adjustments, preset retention and teacher/projector refresh.
  Real mouse drags cover position persistence, edge limits, keyboard movement,
  reset, different projector sizes and fullscreen toolbar clearance. Drag controls
  stay teacher-only.
  It also encodes a short synthetic WebM in-browser and checks actual decoded
  playback in the supported URL Viewer workflow on teacher and projector,
  playback beneath the rail in whole-layout fullscreen, native video-element
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
- `npm run check:compact-controls`: compact menu interactions, repeated Home
  navigation and keyboard isolation, selector/custom sizing persistence,
  narrow controls and popup bounds, fullscreen recovery and nested Escape,
  projector privacy/reconnect/expansion, and a real HTTP-cache upgrade test.

Screenshots are generated under `output/playwright/` and kept outside the commit.
The follow-up navigation layout keeps Previous and Next adjacent in one group,
with the slide selector outside that group. Small widgets retain both 44px
targets on one row; their minimum width is constrained by the layout manager.
Desktop, 390px and fullscreen captures were visually checked, and compact
navigation, repository checks, linked presentation and cache checks passed.
The original instruction-rail feature was based on upstream
`a4ebc1c5bf49dd95be73ecbd05b4cdf54336e311`. The compact-control follow-up is based
on `3710e611c4aa7258a0964f3306a6f3ab4cfb3a6f`, preserving the subsequent menu work.
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
4. Merge/deploy only after Daniel explicitly approves the release. Publication
   of the compact-control follow-up was subsequently authorised; retain the
   same verification and backup steps for future releases.
5. After approved deployment, verify old decks stay hidden, saved instructions
   survive refresh, switching to an empty deck clears both displays, and
   projector reconnect restores the active lesson. Roll back the release commit
   if needed; restore the pre-upgrade JSON backup if deck data also needs rollback.
