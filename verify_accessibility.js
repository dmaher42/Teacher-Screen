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

const tabList = document.querySelector('.nav-tabs');
assert(tabList && tabList.getAttribute('role') === 'tablist', 'Nav tabs container should have role="tablist"');

const tabs = document.querySelectorAll('.nav-tab[role="tab"]');
assert(tabs.length > 0, 'Should have tabs with role="tab"');
tabs.forEach(tab => {
    assert(tab.getAttribute('aria-selected') !== null, `Tab ${tab.id} should have aria-selected`);
    assert(tab.getAttribute('aria-controls') !== null, `Tab ${tab.id} should have aria-controls`);
    assert(document.getElementById(tab.getAttribute('aria-controls')), `Tab ${tab.id} controls non-existent panel ${tab.getAttribute('aria-controls')}`);
});

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

// Teacher controls and primary app controls
const teacherPanel = assertElement('teacher-panel');
assert(teacherPanel.tagName === 'ASIDE', 'Teacher panel should be an <aside> element');
assert(teacherPanel.getAttribute('role') === 'complementary', 'Teacher panel should have role="complementary"');
assert(teacherPanel.getAttribute('aria-label') === 'Teacher controls', 'Teacher panel should have aria-label="Teacher controls"');

const addWidgetButton = assertElement('add-widget-btn');
assert(addWidgetButton.getAttribute('aria-label') === 'Add widget', 'Add widget button should have an accessible label');
assertElement('widget-modal', 'Widget picker dialog should exist');
assertElement('widget-settings-modal', 'Widget settings modal should exist');

// Projector entrypoint
const projectorHtml = fs.readFileSync(path.join(root, 'projector', 'index.html'), 'utf8');
assert(projectorHtml.includes('../projector.html'), 'Projector folder entry should redirect to projector.html');
assert(fs.existsSync(path.join(root, 'projector.html')), 'projector.html should exist');

console.log('All static checks passed!');
