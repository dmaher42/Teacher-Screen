# Persistent Text Boards

Student instructions now use the native Text Board widget and its existing rich
editor, display mode, drag, resize, layering, projector and privacy behaviour.
Open a board’s ⋯ options menu to access two independent options:

- Show on every page: share this board across the current deck's pages.
- Keep in front of presentations: use the front Text Board layer above expanded
  in-app slides and embedded media. Native video fullscreen and external apps own
  their surface and cannot retain other app content.

Teacher Controls > Text Boards can add a board with both options enabled. Present
screen retains all front boards and the existing recovery controls. Present media
only temporarily hides front boards on the teacher screen. The projector retains
its normal synced board settings.

## Saved data and compatibility

The legacy `instructions` field is retained for compatibility with every existing
deck, preset, rename, duplicate, export and import projection. Its original public
text and size/position fields remain an untouched recovery source. A
`textBoardsMigrated` marker makes conversion idempotent and prevents deleted
converted boards from reappearing. `instructions.boards` holds a normal layout
containing shared RichTextWidget records, not a separate text editor or renderer.

Legacy text is escaped, converted to editable paragraphs and displayed by one
native Text Board. Its relative width, height, position and font size are retained,
with a dark appearance matching the former panel. Originally hidden instructions
start minimised and excluded from the projector. Empty legacy decks add no board.
Before the first upgrade write, the app attempts one local recovery copy of the
original state and preset strings under `teacherScreenTextBoardUpgradeBackup-v1`.
If storage is full, legacy instruction text still remains in deck data.

Shared boards are captured before saving/switching pages and excluded from page
snapshots. The active page is composed with the shared records at restore time.
Turning off sharing returns the board to its current page. Promoting a page board
uses a unique shared ID to avoid collisions with another page's widgets. Deletion
removes the single shared record. Clear current page preserves shared boards,
background, theme and lesson plan. Switching decks never carries shared boards
across deck/class boundaries.

Each shared/front record carries its own viewport. Native layout serialization,
restoration and resize deltas retain proportional geometry across screen sizes.
The native LayoutManager mounts front boards in an isolated student-view layer;
ordinary widgets retain their normal layers and page scope. Adding a widget in an
unchanged layout mode preserves already-mounted presentation players.

Projector state contains native `serializeForProjector` records only. Compatibility
storage is not sent to the projector, so private shared content cannot leak via
that field. The normal teacher-only and projector visibility controls still apply.

## Verification

- `npm run check`: syntax, accessibility/structure, PWA, AI, reminders and editor.
- `npm run check:instruction-rail`: compatibility alias for migration contracts,
  native persistent Text Board browser checks and real embedded video/fullscreen.
- `npm run check:linked-presentation-sync`: actual PDF/PPTX imports, teacher and
  projector navigation, reconnect and front Text Boards over expanded slides.
- `npm run check:compact-controls`: presentation keyboard/navigation/menu checks,
  shared Text Board persistence, fullscreen recovery and mixed-cache upgrades.
- `npm run check:widget-startup` and `npm run check:projector-sync`: unrelated
  widget startup, timers, privacy, geometry and reconnect regression checks.

Browser checks use isolated headless Edge contexts and synthetic lesson data.
`TEACHER_SCREEN_SMOKE_URL` runs the persistent Text Board checks against a
published deployment. Screenshots remain in ignored `output/playwright/`.

## Text Board formatting toolbar

The common bar contains text style, a compact text size selector, bold/italic/underline, lists, More and a
Finish editing check mark. It wraps at narrow widths rather than hiding tools
in a horizontal scroll area. SVG icons need no external icon font.

More groups Undo/Redo, links and clear formatting first, then colour/highlight,
alignment and spacing. Text size is available directly without opening More. Teaching blocks/callouts expand on
request. Menus remember the selected text, close with Escape, and scroll inside
the board. Blocks insert at the caret and undo in one step. Columns uses Quill's
native editable 2×2 table module and persists through the usual HTML save path.
Clear formatting retains words, images, image dimensions and table structure;
with no selection it clears the current paragraph. Basic editing and Finish
editing remain available if the external Quill library cannot load.

`npm run check:text-board-toolbar` exercises every formatting action against real
Quill, selection preservation, one-step undo, insertion, image/table retention,
projector/reload persistence, and toolbar/menu geometry at 520/432/360/260 pixels.
