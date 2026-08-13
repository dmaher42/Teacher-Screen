const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;

function assert(condition, message) {
    if (!condition) {
        console.error(`FAIL: ${message}`);
        process.exit(1);
    } else {
        console.log(`PASS: ${message}`);
    }
}

function assertElement(id, message = `#${id} should exist`) {
    const element = document.getElementById(id);
    assert(element, message);
    return element;
}

console.log('Verifying Teacher Screen static structure...');

// Main navigation
const topNav = assertElement('top-nav');
assert(topNav && topNav.getAttribute('aria-label') === 'Main sections', 'Top nav should have aria-label="Main sections"');

const homeButton = assertElement('sections-toggle');
assert(homeButton.getAttribute('aria-label') === 'Home', 'The top navigation button should be labelled Home by default');
assert(!homeButton.hasAttribute('aria-haspopup') && !homeButton.hasAttribute('aria-controls'), 'Home should not claim to open or control the Sections picker');

const sectionsMenu = assertElement('sections-menu');
const sectionsMenuTitle = assertElement('sections-menu-title');
const sectionsMenuClose = assertElement('sections-menu-close');
assert(sectionsMenu.hasAttribute('hidden'), 'Sections should be closed by default');
assert(sectionsMenu.getAttribute('aria-labelledby') === sectionsMenuTitle.id, 'Sections should reference its visible title');
assert(Boolean(sectionsMenuClose.getAttribute('aria-label')), 'Sections should have a labelled close button');

const tabList = document.querySelector('.nav-tabs');
assert(tabList && tabList.getAttribute('role') === 'tablist', 'Nav tabs container should have role="tablist"');

const tabs = document.querySelectorAll('.nav-tab[role="tab"]');
assert(tabs.length === 5, 'Sections should have five direct tabs');
tabs.forEach(tab => {
    assert(tab.getAttribute('aria-selected') !== null, `Tab ${tab.id} should have aria-selected`);
    assert(tab.getAttribute('aria-controls') !== null, `Tab ${tab.id} should have aria-controls`);
    assert(document.getElementById(tab.getAttribute('aria-controls')), `Tab ${tab.id} controls non-existent panel ${tab.getAttribute('aria-controls')}`);
});
assert(Array.from(tabList.children).every(child => child.matches('.nav-tab[role="tab"]')), 'The Sections tablist should contain only direct tab children');

const deckLibraryDestination = assertElement('manage-screens-btn');
assert(!tabList.contains(deckLibraryDestination), 'Deck Library should be separate from the five section tabs');
assert(deckLibraryDestination.textContent.includes('Deck Library'), 'The separate deck destination should be clearly labelled Deck Library');
assert(!deckLibraryDestination.hasAttribute('role'), 'Deck Library should be an ordinary destination button rather than a sixth tab');
assert(!sectionsMenu.querySelector('.screen-manager-body'), 'Sections should stay navigation-only without embedded deck controls');

const screenDeckManager = assertElement('screen-deck-manager-dialog');
assert(screenDeckManager.tagName === 'DIALOG', 'Deck details should use a dedicated dialog');
assert(screenDeckManager.getAttribute('aria-labelledby') === 'screen-deck-manager-title', 'Deck details dialog should reference its visible title');
assert(assertElement('screen-deck-manager-title').textContent.trim() === 'Deck details & backup', 'Deck details dialog should use its approved title');
assert(!screenDeckManager.hasAttribute('open'), 'Deck details dialog should be closed by default');
assert(Boolean(screenDeckManager.querySelector('.modal-close[aria-label]')), 'Deck details dialog should have a labelled close button');
assert(!sectionsMenu.contains(screenDeckManager), 'Deck details dialog should live outside global navigation');
assert(Boolean(screenDeckManager.querySelector('.screen-manager-body')), 'Deck details dialog should contain the current deck actions');

const classProfileSelect = assertElement('class-profile-select');
const layoutPresetSelect = assertElement('layout-preset');
const applyLayoutPreset = assertElement('apply-layout-preset');
assert(screenDeckManager.contains(classProfileSelect) && Boolean(screenDeckManager.querySelector('label[for="class-profile-select"]')), 'Deck details should contain a labelled class filter');
assert(screenDeckManager.contains(layoutPresetSelect) && Boolean(screenDeckManager.querySelector('label[for="layout-preset"]')), 'Deck details should contain one labelled saved-deck selector');
assert(applyLayoutPreset.textContent.trim() === 'Open deck', 'Loading a selected saved deck should require the explicit Open deck action');
assert(screenDeckManager.querySelectorAll('#layout-preset').length === 1 && !screenDeckManager.querySelector('#preset-list'), 'Deck details should not contain duplicate saved-deck lists');

['preset-name', 'preset-class-name', 'preset-period'].forEach((id) => {
    const input = assertElement(id);
    assert(screenDeckManager.contains(input) && Boolean(screenDeckManager.querySelector(`label[for="${id}"]`)), `Deck details should contain a labelled #${id} field`);
});
const savePreset = assertElement('save-preset');
const saveSnapshot = assertElement('save-snapshot-btn');
assert(savePreset.textContent.trim() === 'Save changes', 'Current deck metadata should use the explicit Save changes action');
assert(saveSnapshot.textContent.replace(/\s+/g, ' ').trim() === 'Save dated copy', 'Deck backup should be labelled Save dated copy');
const advancedDeckTools = screenDeckManager.querySelector('.screen-manager-advanced');
assert(Boolean(advancedDeckTools) && !advancedDeckTools.hasAttribute('open'), 'Export and import should start inside a collapsed advanced disclosure');
assert(Boolean(advancedDeckTools?.querySelector('#export-layout')) && Boolean(advancedDeckTools?.querySelector('#import-layout')), 'The advanced disclosure should contain Export decks and Import decks');

const resetLayout = assertElement('reset-layout');
assert(!screenDeckManager.contains(resetLayout), 'Deck details should not contain Clear current page');
assert(document.querySelectorAll('#reset-layout').length === 1
    && Boolean(resetLayout.closest('#teacher-panel'))
    && Boolean(resetLayout.closest('.project-page-advanced')), 'Clear current page should occur once in Teacher Controls > More page actions');

// Default route is Dashboard. Classroom still exists as the teaching canvas.
const dashboardTab = assertElement('dashboard-tab');
assert(dashboardTab.classList.contains('active'), 'Dashboard tab should be active by default');
assert(dashboardTab.getAttribute('aria-selected') === 'true', 'Dashboard tab should be selected by default');

const dashboardView = assertElement('dashboard-view');
assert(dashboardView.getAttribute('role') === 'tabpanel', 'Dashboard view should have role="tabpanel"');
assert(dashboardView.getAttribute('aria-labelledby') === 'dashboard-tab', 'Dashboard view should be labelled by tab');
assert(!dashboardView.hasAttribute('hidden'), 'Dashboard view should be visible by default');

const classroomTab = assertElement('classroom-tab');
assert(classroomTab.getAttribute('aria-selected') === 'false', 'Classroom tab should not be selected by default');

const classroomView = assertElement('classroom-view');
assert(classroomView.getAttribute('role') === 'tabpanel', 'Classroom view should have role="tabpanel"');
assert(classroomView.getAttribute('aria-labelledby') === 'classroom-tab', 'Classroom view should be labelled by tab');
assert(classroomView.hasAttribute('hidden'), 'Classroom view should be hidden until selected');

const studentMain = assertElement('student-view');
assert(studentMain.tagName === 'SECTION', 'Student main should be a <section> element');
assert(studentMain.getAttribute('role') === 'main', 'Student main should have role="main"');
assert(studentMain.getAttribute('aria-label') === 'Student view', 'Student main should have aria-label="Student view"');

const reminderDock = assertElement('classroom-reminder-dock');
assert(reminderDock.tagName === 'ASIDE', 'Classroom reminder dock should be an <aside> element');
const reminderTitleId = reminderDock.getAttribute('aria-labelledby');
assert(reminderTitleId && document.getElementById(reminderTitleId), 'Classroom reminder dock should have an accessible title');
const reminderToggle = assertElement('classroom-reminder-toggle');
assert(Boolean(reminderToggle.getAttribute('aria-label')), 'Classroom reminder toggle should have an accessible name');
const reminderPanelId = reminderToggle.getAttribute('aria-controls');
const reminderPanel = reminderPanelId ? document.getElementById(reminderPanelId) : null;
assert(Boolean(reminderPanel), 'Classroom reminder toggle should control a real panel');
assert(reminderToggle.getAttribute('aria-expanded') === String(!reminderPanel.hasAttribute('hidden')), 'Reminder toggle state should match panel visibility');
const reminderForm = assertElement('classroom-reminder-form');
assert(Boolean(reminderForm.querySelector('label[for="classroom-reminder-input"]')), 'Classroom reminder input should have a label');
assert(Boolean(reminderForm.querySelector('fieldset legend')), 'Classroom reminder scope choices should have a legend');

// Teacher controls and primary app controls
const teacherPanel = assertElement('teacher-panel');
assert(teacherPanel.tagName === 'ASIDE', 'Teacher panel should be an <aside> element');
assert(teacherPanel.getAttribute('role') === 'dialog', 'Teacher panel should have role="dialog"');
assert(teacherPanel.getAttribute('aria-modal') === 'true', 'Teacher panel should be modal while open');
const teacherPanelTitleId = teacherPanel.getAttribute('aria-labelledby');
assert(teacherPanelTitleId && document.getElementById(teacherPanelTitleId), 'Teacher panel should reference its visible title');
assert(teacherPanel.getAttribute('aria-hidden') === 'true', 'Teacher panel should be hidden from assistive technology by default');
assert(teacherPanel.hasAttribute('inert'), 'Teacher panel should be inert by default');

const addWidgetButton = assertElement('add-widget-btn');
assert(addWidgetButton.getAttribute('aria-label') === 'Add widget', 'Add widget button should have an accessible label');
assertElement('widget-modal', 'Widget picker dialog should exist');
assertElement('widget-settings-modal', 'Widget settings modal should exist');

// Projector entrypoint
const projectorHtml = fs.readFileSync(path.join(root, 'projector', 'index.html'), 'utf8');
assert(projectorHtml.includes('../projector.html'), 'Projector folder entry should redirect to projector.html');
assert(fs.existsSync(path.join(root, 'projector.html')), 'projector.html should exist');

console.log('All static checks passed!');
