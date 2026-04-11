# Teacher Screen UX Audit

## Overview
This audit evaluates the UX of the Teacher Screen project from the perspective of a teacher managing a live classroom environment. The primary constraint is cognitive load: a teacher operates this software while actively managing student behavior, answering questions, and monitoring pacing. Errors must be minimized, and the state of what students can see (the projector) must be immediately obvious.

---

## 1. Teacher Screen UX

### Strengths
* **Absolute Grid System:** The 20px snap grid gives teachers predictable spatial organization for their dashboards.
* **Floating Action Button (FAB) & Shortcuts:** Using a FAB and keyboard shortcuts (`Ctrl+Alt+W`) to add widgets reduces the need to hunt through deep menus.
* **Granular Timer Inputs:** Using distinct inputs for HH, MM, SS in the control panel allows for precise global timer setup without dealing with complex text parsing (e.g., typing "5:00").

### Pain Points
* **Hidden Controls (Settings Modals):** Moving widget controls (like removal and projector visibility toggling) to a hover-activated Settings Modal adds clicks to critical, frequent actions. When a teacher needs to quickly kill a widget, hunting for a hover button and opening a modal is too slow.
* **Accordion Overload in Teacher Panel:** The Teacher Controls panel uses multiple `<details>` elements. If multiple are open, it pushes critical controls down, requiring scrolling. When under time pressure, vertical scrolling to find a specific setting (e.g., Presentation controls vs Timer controls) increases cognitive load.
* **Separation of Timer Display and Controls:** The timer splits its UI between `mainDisplay` and `controlsOverlay`. If a teacher needs to rapidly pause or add 1 minute to a running timer based on class dynamics, they have to navigate to the settings overlay rather than clicking directly on the widget.

---

## 2. Projector Screen UX

### Strengths
* **Fluid Typography:** Extensive use of `clamp()` CSS functions for things like the Quick Quiz widget ensures text scales gracefully and remains legible from the back of the room, regardless of projector resolution.
* **Clutter Reduction:** Hiding headers, resize handles, and settings buttons in projector mode (`projector.html`) correctly minimizes distractions for students.
* **High Contrast Statuses:** Timer and Quiz widgets use clear color changes (e.g., `#fca5a5` for finished timers, green for correct answers) which read well on washed-out projectors.

### Pain Points
* **Lack of Empty States:** If the teacher accidentally clears the board, the projector might just show a blank screen or a default theme background, leaving students without context.
* **Information Density in Complex Widgets:** Widgets like the Quick Quiz scoreboard might become cramped if there are many teams or long question text, especially in `.is-tight` mode. Legibility degrades quickly on low-quality classroom projectors when grid gaps shrink.

---

## 3. Widgets

### Strengths
* **Consistent Interaction Model:** Dragging the entire widget container rather than relying on a tiny header handle is a gross-motor movement, which is much easier to perform while standing at a smartboard or hastily using a trackpad.
* **Accessibility:** Using a 3px solid gold outline with offset for the focused state (`:focus-within`) is excellent for visibility and keyboard navigation.

### Pain Points
* **Inconsistent Edit/Management States:** The `NotesWidget` separates content editing (expanded overlay on click) from management actions (settings modal). This breaks the mental model established by other widgets. Teachers have to remember *how* to interact with specific widgets rather than relying on a universal pattern.
* **Discoverability of Widget Settings:** Because the settings button only appears on hover (`.widget-settings-btn`), a new teacher or a teacher using a touchscreen (where hover doesn't exist) will struggle to figure out how to configure or delete a widget.

---

## 4. Teacher ↔ Projector Relationship

### Strengths
* **Dedicated Projector View:** Having a physically separate `projector.html` prevents accidental exposure of private teacher notes or controls (like the student list).

### Pain Points
* **Invisible Projection State:** Because widget headers were removed and visibility controls are buried in the Settings Modal, there is **no immediate visual indicator on the Teacher Screen to show which widgets are currently projected to the students.** This is the most dangerous UX flaw. A teacher might assume a sensitive note or a staging widget is hidden, only to realize it's live on the projector.
* **Sync Confidence:** There is no "Live / Connected" indicator to reassure the teacher that the projector window is actively syncing with their dashboard. If the projector window crashes or disconnects in the background, the teacher won't know until a student points it out.

---

## Prioritized Actionable Recommendations

### Critical (Fix immediately to prevent classroom disruption)
1. **Surface Projection State:** Add a highly visible, persistent indicator directly on the widget container in the Teacher Screen (e.g., a colored border or a distinct "Live" badge) to show if a widget is currently visible on the projector. Do not hide this behind a hover or a modal.
2. **Move "Hide/Show" and "Delete" Out of Modals:** Add persistent, quick-action buttons for "Toggle Projector" and "Close" directly on the widget surface (perhaps in a compact footer or persistent corner icon). Teachers need 1-click access to these actions.

### Important (Improves speed and reduces cognitive load)
3. **Touch-Friendly Settings:** Change the widget settings button from "hover-only" to persistent but low-contrast, or ensure a single tap on the widget brings up the quick controls. This fixes the issue for teachers using iPads, smartboards, or touch screens.
4. **Accordion Management:** Implement an "accordion group" behavior in the Teacher Panel where opening one `<details>` element automatically closes the others, keeping the panel compact and eliminating the need to scroll frantically.
5. **Inline Timer Adjustments:** Allow basic timer controls (Pause, +1 Min) directly on the Timer widget surface on the Teacher Screen without needing to open the settings modal.

### Nice-to-have (Polishing the experience)
6. **Projector Connection Status:** Add a small "Projector Connected" green dot indicator to the Teacher Panel header.
7. **Consistent Edit Triggers:** Unify how widgets enter an "edit" state. Instead of some using modals and others using expanded overlays (like `NotesWidget`), consider a unified full-screen edit mode or consistent inline editing for all text-heavy widgets.