import re
import time
from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a larger viewport to minimize overlapping issues
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()

        print("Navigating to app...")
        page.goto("http://localhost:8000")

        # Clear local storage to ensure clean state
        print("Clearing local storage...")
        page.evaluate("window.localStorage.clear()")
        page.reload()

        # Handle Welcome Tour
        try:
            print("Checking for tour dialog...")
            # Wait a moment for it to appear
            time.sleep(1)
            tour_dialog = page.locator("#tour-dialog")
            if tour_dialog.is_visible():
                print("Tour dialog is visible.")
                # Try clicking the "Start Teaching" button first as it's the primary action
                start_btn = tour_dialog.locator("button.modal-primary")
                if start_btn.is_visible():
                    start_btn.click()
                    print("Clicked 'Start Teaching'.")
                else:
                    # Fallback to close button
                    close_btn = tour_dialog.locator(".modal-close")
                    close_btn.click()
                    print("Clicked close button.")

                # Wait for dialog to disappear
                expect(tour_dialog).not_to_be_visible(timeout=5000)
                print("Tour dismissed.")
            else:
                print("Tour dialog not visible.")
        except Exception as e:
            print(f"Error handling tour: {e}")

        # Open Widget Toolbar
        print("Opening widget toolbar...")
        toolbar = page.locator("#widget-toolbar-wrapper")
        toggle_btn = page.locator("#toolbar-toggle-btn")

        # Check if toolbar is already open
        if "toolbar-open" not in str(toolbar.get_attribute("class")):
            if toggle_btn.is_visible():
                toggle_btn.click()
                print("Clicked toolbar toggle.")
                # Wait for transition
                time.sleep(0.5)
            else:
                print("Toolbar toggle button not visible!")

        # Add Timer Widget
        print("Adding Timer widget...")
        timer_btn = page.locator("#timer-widget-btn")
        # Ensure the button is visible and enabled
        expect(timer_btn).to_be_visible()
        timer_btn.click()
        print("Clicked Timer widget button.")

        # Wait for widget to appear
        timer_widget = page.locator(".timer-widget").first
        expect(timer_widget).to_be_visible()
        print("Timer widget added.")

        # Close the toolbar to avoid overlap
        print("Closing toolbar...")
        if toggle_btn.is_visible():
            toggle_btn.click()
            time.sleep(0.5)

        # Check initial state: NOT expanded
        print("Checking initial state (should not be expanded)...")
        page.screenshot(path="verification/before_check.png")

        # Verify it does NOT have the 'expanded' class
        # Note: Using regex to be safe against class order
        expect(timer_widget).not_to_have_class(re.compile(r'\bexpanded\b'))

        # Get the header to click
        header = timer_widget.locator(".widget-header")

        # Perform Click to Expand
        print("Clicking header to expand...")
        header.click(force=True)

        # Wait for transition
        time.sleep(0.5)

        # Check state: EXPANDED
        print("Checking expanded state...")
        page.screenshot(path="verification/after_click.png")
        expect(timer_widget).to_have_class(re.compile(r'\bexpanded\b'))

        # Perform Click to Collapse
        print("Clicking header to collapse...")
        header.click(force=True)

        # Wait for transition
        time.sleep(0.5)

        # Check state: NOT expanded
        print("Checking collapsed state...")
        page.screenshot(path="verification/final_state.png")
        expect(timer_widget).not_to_have_class(re.compile(r'\bexpanded\b'))

        print("Verification passed!")

        # Keep browser open for a moment if needed (not in headless)
        browser.close()

if __name__ == "__main__":
    run()
