# Week Projects and Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a teacher save one weekly project, create blank pages inside it, and switch between those pages while keeping each page's widgets and layout separate.

**Architecture:** Extend the existing Teacher-Screen save/load path so the current classroom loadout becomes a project container with an ordered `pages[]` array and one `activePageId`. Each page stores its own snapshot of widgets, background, theme, and lesson content, while the existing `layoutManager`, `backgroundManager`, and lesson editor continue to provide the actual page state. Page switches will auto-save the current page before loading the next one, so the teacher can move through a week of lessons without rebuilding anything.

**Tech Stack:** Plain browser JavaScript, `localStorage`, existing Teacher-Screen DOM, existing `LayoutManager`, existing background/theme/lesson-plan widgets.

---

### Task 1: Add the page data model and migration path

**Files:**
- Modify: `C:\Users\dmahe\OneDrive\Desktop\Codex\teacher-screen-clean\js\main.js`

- [ ] **Step 1: Add the project/page state shape**

```js
{
  projectName: 'Week 3 HASS',
  activePageId: 'page-monday',
  pages: [
    {
      id: 'page-monday',
      name: 'Monday',
      snapshot: {
        theme: 'theme-professional',
        background: { /* existing background serialisation */ },
        layout: { /* existing layout serialisation */ },
        lessonPlan: [ /* existing editor contents */ ]
      }
    }
  ]
}
```

- [ ] **Step 2: Update the saved-state builder**

Add page fields to `buildStateSnapshot()` so the active project persists `projectName`, `activePageId`, and the `pages` array alongside the existing classroom data.

- [ ] **Step 3: Add a migration for old saves**

When older saves do not contain pages, convert the current single layout into one default page named `Page 1` so existing users do not lose their current screen.

- [ ] **Step 4: Verify the migration shape in code**

Run: `node --check js/main.js`

Expected: the file still parses, and old single-layout saves can be promoted to the new project/page format without breaking load.

### Task 2: Add page controls to the current screen manager

**Files:**
- Modify: `C:\Users\dmahe\OneDrive\Desktop\Codex\teacher-screen-clean\index.html`
- Modify: `C:\Users\dmahe\OneDrive\Desktop\Codex\teacher-screen-clean\css\main.css`
- Modify: `C:\Users\dmahe\OneDrive\Desktop\Codex\teacher-screen-clean\js\main.js`

- [ ] **Step 1: Add the page controls to the `Manage Screens` panel**

Replace the current `Class Screens` framing with project/page wording so the panel reads like a weekly project manager:

```html
<label for="project-select">Current Project</label>
<select id="project-select"></select>
<button id="new-project-btn">New Project</button>
<button id="new-page-btn">New Page</button>
<button id="duplicate-page-btn">Duplicate Page</button>
<button id="rename-page-btn">Rename Page</button>
<button id="delete-page-btn">Delete Page</button>
```

The panel should still keep the existing save/load and export/import actions, but those actions now work on the current project and its pages.

- [ ] **Step 2: Add a compact page switcher on the teacher screen**

Add a small page bar in the main teacher view so the teacher can jump between lesson pages quickly without reopening the menu.

- [ ] **Step 3: Style the new controls**

Add CSS so the page bar feels like part of Teacher-Screen rather than a separate app:

```css
.project-page-bar { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.project-page-button { border-radius: 999px; }
.project-page-button.is-active { background: var(--brand); color: white; }
```

- [ ] **Step 4: Verify the controls render cleanly**

Run: `node --check js/main.js`

Then open the app and confirm the new project/page controls appear only once, inside the screen-management flow.

### Task 3: Wire page creation, switching, duplication, and deletion

**Files:**
- Modify: `C:\Users\dmahe\OneDrive\Desktop\Codex\teacher-screen-clean\js\main.js`

- [ ] **Step 1: Add page helper methods**

Add focused helpers for:
- `createNewPage(name)`
- `switchToPage(pageId)`
- `duplicateCurrentPage()`
- `renameCurrentPage()`
- `deleteCurrentPage()`
- `saveCurrentPageSnapshot()`

Each helper should only touch the active project and should reuse the existing layout/background/lesson-plan serialization paths instead of inventing a second state source.

- [ ] **Step 2: Save the current page before switching**

Switching pages must:
1. capture the current page into its page snapshot
2. load the selected page snapshot into the live layout manager
3. update the active project/page indicators in the UI

- [ ] **Step 3: Keep widget changes page-scoped**

Any existing save triggers from widget add/remove/move, background changes, theme changes, and lesson editor edits should now update the current page snapshot rather than flattening everything into one long screen history.

- [ ] **Step 4: Add sensible default behavior for new projects**

Creating `Week 3 HASS` should start with one blank page. Creating a new page after that should add another blank page, not clone the whole week unless the user explicitly chooses duplicate.

- [ ] **Step 5: Verify page switching in a browser**

Test flow:
1. Create a new project named `Week 3 HASS`
2. Create `Monday` and `Tuesday`
3. Add a widget to `Monday`
4. Switch to `Tuesday`
5. Confirm `Tuesday` is blank
6. Switch back to `Monday`
7. Confirm the widget is still there

### Task 4: Update project save/load, export/import, and restore behavior

**Files:**
- Modify: `C:\Users\dmahe\OneDrive\Desktop\Codex\teacher-screen-clean\js\main.js`

- [ ] **Step 1: Make save/load operate on projects**

The existing screen save/load actions should now save and load the whole project record, including its page list and the current active page.

- [ ] **Step 2: Preserve old imports**

If an imported file only contains the old single-layout shape, convert it into a one-page project automatically so old exports still load.

- [ ] **Step 3: Keep project updates visible after restore**

After loading a project, refresh the page bar, the project selector, the active page highlight, and the live canvas so the UI matches the restored project immediately.

- [ ] **Step 4: Verify export/import still works**

Run the existing export/import flow in the browser and confirm:
- a project exports successfully
- a project imports successfully
- the imported project still has its pages

### Task 5: Browser verification and cleanup

**Files:**
- Modify if needed: `C:\Users\dmahe\OneDrive\Desktop\Codex\teacher-screen-clean\js\main.js`
- Modify if needed: `C:\Users\dmahe\OneDrive\Desktop\Codex\teacher-screen-clean\index.html`
- Modify if needed: `C:\Users\dmahe\OneDrive\Desktop\Codex\teacher-screen-clean\css\main.css`

- [ ] **Step 1: Run syntax checks**

Run:

```powershell
node --check js/main.js
```

Expected: no parse errors.

- [ ] **Step 2: Browser-verify the weekly project flow**

Use the in-app browser or localhost preview to confirm:
- a new project can be created
- new blank pages can be added
- page buttons switch pages
- each page keeps its own widgets
- reload restores the last active page

- [ ] **Step 3: Commit and push**

```powershell
git add js/main.js index.html css/main.css docs/superpowers/plans/2026-04-28-week-project-pages.md
git commit -m "feat: add weekly project pages"
git push origin main
```

---

### Self-Review

- Spec coverage: the plan covers the project/page data model, UI controls, page switching, persistence, migration, and browser verification.
- Placeholder scan: no TBDs or hand-wavy steps remain.
- Type consistency: the plan consistently uses `project`, `page`, `activePageId`, and `pages[]` across all tasks.
- Scope check: this is one feature area, not multiple disconnected systems.
