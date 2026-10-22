# Control slides from Teacher Screen

1. Open a PowerPoint or PDF in the presentation widget. A supported downloadable link imports a copy into the same player.
2. Open the paired projector once and move its window to the projector display.
3. Use **Previous**, **Next**, or **Select slide** in Teacher Screen. The projector follows automatically, including after a projector refresh. There is no presentation mode or tab-sharing prompt.
4. **Full screen on projector** expands only the slides to fill the projector window. **Return projector to classroom** restores its classroom layout without changing the teacher view or selected slide.

The button fills the projector's webpage. Browser bars still require F11 in the projector window; browsers do not reliably allow a teacher-window click to grant fullscreen permission to another window.

Google Slides links import a PDF copy using an existing authorised Drive connection, or a publicly downloadable PDF export when permitted. PDF copies do not preserve animations or videos and must be imported again after online edits. The checked-in Drive configuration has no OAuth client ID; private Google files therefore require an already configured connection or downloading/uploading a PDF. This update does not create a Google Cloud project or change access permissions.

PowerPoint links need an accessible direct PPTX/PDF download (including an Office embed URL containing such a download in its `src` parameter). Microsoft sign-in/viewing links cannot be controlled as independent embedded pages: download the file and choose it in Teacher Screen. Failed link imports keep the current presentation. Imported PowerPoint files retain their existing in-app editor.

## Verification

`npm run check:linked-presentation-sync` checks the teacher controls against a paired projector using the real Reveal player, including slide selection, normal layout, projector-only expansion, reconnect, source changes, closing, and failed protected links. Provider downloads use controlled fixtures; this does not prove access to a particular school's Google or Microsoft account.
