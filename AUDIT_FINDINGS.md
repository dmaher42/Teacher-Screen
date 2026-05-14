# Bootstrap Audit Findings

## Status
Resolved.

The original bootstrap issue described here has been fixed. `js/main.js` now
uses a ready-state-safe startup gate:

```js
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
```

## What was fixed
The app previously loaded `js/script.js` and `js/main.js` after
`DOMContentLoaded` had already fired. Those scripts only initialized from a
`DOMContentLoaded` listener, so the listener could be registered too late and
the classroom app could remain inert.

`js/main.js` now starts immediately when the document is already ready, while
still waiting for `DOMContentLoaded` during normal early loading.

## Current verification
Run the full verification pass with:

```bash
npm run check:all
```

That command checks syntax, validates the static app structure, and runs a
browser smoke test covering:

- Dashboard startup
- Classroom opening
- Pomodoro and Drawing Tool widget creation
- saved screen reload
- projector rendering of saved widgets
- absence of browser page errors and console errors in the smoke path

## Remaining follow-up
This audit only covered bootstrap behavior. Wider runtime areas still worth
testing separately include drag/resize, Notes, Planner scheduling, Quiz Game,
Rich Text, Reveal slides, mobile layout, and presentation links.
