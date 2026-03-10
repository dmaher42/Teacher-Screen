# Bootstrap Audit Findings

## Root cause
The app bootstrap (`js/index.js`) loads many dependency scripts before dynamically importing `js/script.js` and `js/main.js`. By the time those imports run, `DOMContentLoaded` has already fired. Both imported files only initialize inside a `DOMContentLoaded` listener, so their `init()` functions never run.

## Exact stop point
Initialization stops at the DOM-ready gate in `js/main.js`:

- `document.addEventListener('DOMContentLoaded', ...)` in `js/main.js` line 2407.

Because this listener is registered after DOMContentLoaded has already happened, the callback that creates `new ClassroomScreenApp()` and calls `app.init()` never executes.

The same pattern appears in `js/script.js` lines 209-213.

## Evidence
- `index.html` uses only `js/index.js` as the entrypoint.
- `js/index.js` logs successful bootstrap and successfully imports `./script.js` and `./main.js`.
- Network requests return `200` for `js/index.js`, `js/script.js`, and `js/main.js`.
- UI remains inert (e.g., floating `+` button has no behavior) because event listeners are installed by `ClassroomScreenApp.init()`, which never runs.

## CSP warning
A repository-wide search found no local usage of `eval()`, `new Function()`, or `Function(...)`. The CSP warning is likely emitted by an external CDN dependency loaded during bootstrap (for example Quill/PDF/other bundled libs) and is not the direct cause of initialization failure.

## Recommended fix
Use the same ready-state-safe pattern in `js/main.js` already used in `js/index.js` and `js/script.js`:

```js
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
```

Where `startApp()` contains:

```js
const studentMain = document.getElementById('student-main');
if (!studentMain) {
  console.error('Layout container #student-main not found');
  return;
}
const app = new ClassroomScreenApp();
app.init();
```

Apply the same strategy to any module loaded asynchronously that currently assumes DOMContentLoaded has not fired yet.
