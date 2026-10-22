# Control a linked presentation from Teacher Screen

1. Load a Google Slides link or a PowerPoint embed link in the presentation widget.
2. Choose **Sync to projector**. Allow the projector window to open.
3. In the browser sharing prompt, choose **this Teacher Screen tab**. Do not choose the projector tab, a window, or the entire screen.
4. Click inside the Teacher Screen preview to focus it, then use the presentation's own arrows or keyboard controls. The projector shows the same live picture.
5. Choose **Stop syncing** to end sharing. Closing or changing the presentation also ends sharing.

Use a current desktop Chrome or Edge browser. Sharing permission is required each time. Sound is not shared. Refreshing the projector reconnects to the current slide; refreshing Teacher Screen requires starting sharing again.

PowerPoint links must allow embedding. If a link shows a sign-in screen or blocks embedding, Teacher Screen cannot bypass that restriction. Use the provider's embed link or import a PDF instead. The separate Teacher Screen Previous/Next buttons apply to imported or HTML decks; linked presentations use their embedded controls.

Only the presentation element is sent. Teacher menus and notes outside that element are excluded, even when they overlap it. The app never sends an unrestricted whole-tab stream as a fallback.

## Verification

`node tests/projector-linked-presentation-sync.js` uses real browser element capture and a real video connection between teacher and projector windows. Google Slides and PowerPoint URLs serve controlled cross-origin test presentations. The checks cover live slide changes, overlapping teacher notes, layout resizing, projector reload, stopping, cancellation, and rejection of whole-screen capture.

These checks verify the app's sharing flow. They do not verify access or embedding permissions for a particular school or Microsoft account's presentation.
