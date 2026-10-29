# Text Board images and text presentations

Image resizing uses the existing Quill image width format and Text Board HTML save path.
Select an image, drag a corner or use Width %, Fit width or Original. Resizing preserves
aspect ratio. A drag previews in teacher chrome and commits one undoable format operation
on release. Escape/cancel leaves the content unchanged. Existing image dimensions are not
rewritten until an explicit resize. Controls never enter serialized HTML or projector data.

Add Widget > Text presentation creates a separate option using the same Text Board editor.
Previous/Next and slide selection navigate its slides. Pages contains Add slide, Remove
slide and Undo remove. Present uses the existing Text Board presentation and exit controls.
Text undo belongs to the current editing session/slide; changing slide clears editor undo
so it cannot insert another slide's content. Undo remove separately restores the last
removed slide. Removing the only slide is disabled.

The teacher's widget data gains an optional `textPresentation` object containing a version,
pages (`id`, `content`) and `activePageId`. Existing boards omit it. All slides use the normal
deck save/export path. The top-level `content` remains the active slide for compatibility.
Projector serialization removes `textPresentation` and sends only the active public content.
Teacher-only serialization still redacts content completely. No new account, dependency,
upload service or resource storage system is introduced.

Checks:

- `check:text-board-images`: DOM/real Quill checks for image formats, undo/redo, cancellation,
  clipboard, save/reload, privacy and lifecycle.
- `check:text-presentations`: DOM/real Quill checks for slides, editing, deletion/recovery,
  JSON import/export, keyboard isolation and projector payload privacy.
- `node tests/text-board-editing-smoke.js`: isolated browser UI/visual checks. The script
  creates and closes its own temporary browser/server; obtain the required cleanup approval
  before running it under the user's resource-preservation constraint.

The DOM checks do not verify actual CSS geometry or pointer hit testing. Browser/visual QA
is required before release. External image availability and original image resolution are
unchanged by resizing; this feature does not make transient image sources portable.
