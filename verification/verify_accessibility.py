from playwright.sync_api import sync_playwright

def verify_accessibility_features():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:8000")

        # 1. Handle Welcome Tour if present
        # It's a dialog with id="tour-dialog".
        # We can look for the "Start Teaching" button or the close button.
        try:
            start_teaching_btn = page.get_by_role("button", name="Start Teaching")
            if start_teaching_btn.is_visible(timeout=2000):
                start_teaching_btn.click()
                # Wait for modal to close (transition)
                page.wait_for_timeout(500)
        except Exception as e:
            print("No tour dialog found or error closing it:", e)

        # 2. Open the Teacher Controls Panel (to access Theme and Toggle)
        # Assuming the panel is initially closed or we need to ensure it's open.
        # But wait, the app opens with the panel closed.
        # We need to click "Classroom" nav tab to open it.
        # However, if we are already on classroom tab, clicking it toggles the panel.

        # Check if panel is already open?
        # The panel has class "teacher-panel". If it has "open", it's open.
        panel = page.locator("#teacher-panel")
        if not "open" in panel.get_attribute("class"):
            page.get_by_role("button", name="Classroom").click()
            # Wait for panel to open (transition)
            page.wait_for_timeout(1000)

        # 3. Find and expand "Theme" section
        # The text "Theme" is in a summary/h4
        page.get_by_text("Theme").click()
        page.wait_for_timeout(300)

        # 4. Find the "Reduce Motion" toggle
        reduce_motion_checkbox = page.get_by_label("Reduce Motion (limit animations)")

        # 5. Check the toggle
        reduce_motion_checkbox.check()

        # 6. Verify the toggle is checked
        assert reduce_motion_checkbox.is_checked()

        # 7. Verify CSS variable update
        # We need to wait a tiny bit for the event listener to fire? It should be sync though.
        reduce_motion_value = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--reduce-motion').trim()")
        assert reduce_motion_value == "1"

        # 8. Take a screenshot of the controls with the toggle
        page.screenshot(path="verification/verification.png")
        print("Screenshot saved to verification/verification.png")

        # 9. Test focus outline visibility
        # Focus on the toggle
        reduce_motion_checkbox.focus()
        page.screenshot(path="verification/focus_outline.png")
        print("Focus outline screenshot saved to verification/focus_outline.png")

        browser.close()

if __name__ == "__main__":
    verify_accessibility_features()
