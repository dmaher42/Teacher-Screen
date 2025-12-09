const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync('index.html', 'utf8');
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

console.log('Verifying index.html structure...');

// Step 1: Top nav aria-label
const topNav = document.getElementById('top-nav');
assert(topNav && topNav.getAttribute('aria-label') === 'Main sections', 'Top nav should have aria-label="Main sections"');

// Step 1: Tablist
const tabList = document.querySelector('.nav-tabs');
assert(tabList && tabList.getAttribute('role') === 'tablist', 'Nav tabs container should have role="tablist"');

// Step 1: Tabs
const tabs = document.querySelectorAll('.nav-tab[role="tab"]');
assert(tabs.length > 0, 'Should have tabs with role="tab"');
tabs.forEach(tab => {
    assert(tab.getAttribute('aria-selected') !== null, `Tab ${tab.id} should have aria-selected`);
    assert(tab.getAttribute('aria-controls') !== null, `Tab ${tab.id} should have aria-controls`);
    assert(document.getElementById(tab.getAttribute('aria-controls')), `Tab ${tab.id} controls non-existent panel ${tab.getAttribute('aria-controls')}`);
});

// Step 2 & 3: Views and Landmarks
const classroomTab = document.getElementById('classroom-tab');
assert(classroomTab.getAttribute('aria-selected') === 'true', 'Classroom tab should be selected by default');

const classroomView = document.getElementById('classroom-view');
assert(classroomView.getAttribute('role') === 'tabpanel', 'Classroom view should have role="tabpanel"');
assert(classroomView.getAttribute('aria-labelledby') === 'classroom-tab', 'Classroom view should be labelled by tab');

const studentMain = document.getElementById('student-main');
assert(studentMain.tagName === 'MAIN', 'Student main should be a <main> element');
assert(studentMain.getAttribute('role') === 'main', 'Student main should have role="main"');
assert(studentMain.getAttribute('aria-label') === 'Student view', 'Student main should have aria-label="Student view"');

// Step 3: Teacher Panel
const teacherPanel = document.getElementById('teacher-panel');
assert(teacherPanel.tagName === 'ASIDE', 'Teacher panel should be an <aside> element');
assert(teacherPanel.getAttribute('role') === 'complementary', 'Teacher panel should have role="complementary"');
assert(teacherPanel.getAttribute('aria-label') === 'Teacher controls', 'Teacher panel should have aria-label="Teacher controls"');

console.log('All static checks passed!');
