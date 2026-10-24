# Timer menu follow-up

This follow-up was tested separately on the published compact-controls release
`77cd4f9f95a0b24f3a993ea1bdd113894eb37ee9`. Daniel subsequently approved combining
it with the adjacent Previous/Next change for publication. The combined release
retains both fixes and reruns the complete checks before publishing.

## Cause and fix

After the full preceding editing sequence, the timer's native `details` element
reported `open=true`, but its menu body and actions had no rendered bounds.
The same failure was reproduced on unchanged main `3710e61`; minimal timer-only
flows passed. A CSS visibility override applied after failure was insufficient
on its own. Keeping the native disclosure content unlocked from initial load,
and explicitly hiding its menu body while closed, fixes the failing sequence.
This is scoped to teacher-side timer menus and preserves native summary
activation. No JavaScript reopen/rebuild workaround remains.

The expanded keyboard regression also exposed Escape bubbling into the document
widget-deselection handler after the menu had restored focus. An open widget
menu now owns Escape and restores summary focus. Closed menus leave Escape
available for presentation exits.

CSS and JavaScript asset versions are updated together. The cache test warms
the prior release's actual URLs and checks that both corrected assets load.

## Verification on Acer-1

- Full `npm run check:smoke`: passed, with no skipped timer assertion, no page
  errors and no console errors. Includes all preceding menu/deck/class/reminder,
  movement and document flows, then saved decks, projector privacy and mobile UI.
- New regression checks real menu/action dimensions after the failing sequence,
  repeated Enter/Space and Escape, focus restoration and unchanged paused time.
- `npm run check`: passed.
- `node tests/compact-cache-upgrade.js`: passed.
- `npm run check:projector-sync`: passed, including minimized timer counting,
  reconnect, geometry and teacher/private control separation.
- The captured timer menu was visually inspected in isolated Microsoft Edge.
  Test decks and content are synthetic; personal browser profiles, classroom
  data and the original user checkout were not modified.

Earlier experimental fixes failed and were removed. The final canonical run
passes without changing or bypassing the existing timer assertion.

Combined-release validation also waits for projector restore/render work to
settle before measuring visibility resume. An image can appear before those
operations finish; observing it alone can either count initial rendering as a
rebuild or pass through the restore guard without testing resume behavior.
The assertion still requires no rebuild and the same presentation surface.

## Limits

Verification uses the current Edge installation on Acer-1. Other browser
engines and the physical classroom display were not tested in this follow-up.
The underlying native browser issue is characterised by the observed rendering
state and controlled comparisons; no specific upstream browser bug is claimed.
