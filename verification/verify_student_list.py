
from playwright.sync_api import sync_playwright, expect
import os
import json
import re

def verify_student_list_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app
        page.goto("http://localhost:8000")

        # Wait for app to load
        page.wait_for_load_state("networkidle")

        # Dismiss tour dialog if present
        tour_dialog = page.locator("#tour-dialog")
        if tour_dialog.is_visible():
            tour_dialog.get_by_role("button", name="Start Teaching").click()

        # Now click classroom tab
        classroom_tab = page.locator("#classroom-tab")
        classroom_tab.click()

        # Open Teacher Panel explicitly if not open
        teacher_panel = page.locator("#teacher-panel")

        expect(teacher_panel).to_have_class(re.compile(r"open"))

        # Find Student List section
        student_list_summary = page.locator("summary:has-text('Student List')")
        student_list_summary.scroll_into_view_if_needed()

        # Expand it if not expanded
        details = student_list_summary.locator("xpath=..")
        # Check if attribute 'open' exists. Note: get_attribute returns None if not present.
        if details.get_attribute("open") is None:
             student_list_summary.click()

        # Wait for content to be visible
        export_btn = page.locator("#export-students-btn")
        import_btn = page.locator("#import-students-btn")
        list_display = page.locator("#student-list-display")

        expect(export_btn).to_be_visible()
        expect(import_btn).to_be_visible()
        expect(list_display).to_be_visible()

        # Check initial state (No students loaded)
        expect(list_display).to_contain_text("No students loaded")

        if not os.path.exists("verification"):
            os.makedirs("verification")

        # Take screenshot of the panel specifically
        teacher_panel.screenshot(path="verification/teacher_panel_student_list.png")

        # Verify Import logic using localStorage manipulation (simulating import)
        # We can directly inject into localStorage and refresh
        page.evaluate("""() => {
            localStorage.setItem('studentList', JSON.stringify(['Alice', 'Bob', 'Charlie']));
            displayStudents();
        }""")

        expect(list_display).to_contain_text("Alice")
        expect(list_display).to_contain_text("Bob")
        expect(list_display).to_contain_text("Charlie")

        teacher_panel.screenshot(path="verification/teacher_panel_student_list_populated.png")

        browser.close()

if __name__ == "__main__":
    verify_student_list_ui()
