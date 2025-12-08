from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()

        # Load the app
        print("Loading app...")
        page.goto("http://localhost:8000")

        # Close the tour dialog if it's open
        print("Checking for tour dialog...")
        try:
            # Wait a moment for dialog to appear
            page.wait_for_selector("#tour-dialog", state="visible", timeout=2000)
            print("Tour dialog found, closing it...")
            page.click("#tour-dialog .modal-primary")
            # Wait for it to disappear
            page.wait_for_selector("#tour-dialog", state="hidden", timeout=2000)
        except Exception as e:
            print("Tour dialog not found or already closed.")

        # Open widget modal using FAB
        print("Opening widget modal...")
        page.click("#fab")

        # Add Noise Meter
        print("Adding Noise Meter...")
        page.click(".widget-category-btn:has-text('Noise Meter')")

        # Wait for widget to appear
        widget = page.locator(".widget:has-text('NoiseMeter')")
        expect(widget).to_be_visible()
        print("Noise Meter Added!")

        # Check for new settings
        print("Checking new settings...")
        calibrate_btn = widget.locator("button:has-text('Calibrate')")
        expect(calibrate_btn).to_be_visible()
        print("- Calibrate button visible")

        # Check inputs
        # We can find them by the label text
        quiet_label = widget.locator("label:has-text('Quiet Offset:')")
        expect(quiet_label).to_be_visible()
        quiet_input = quiet_label.locator("input")
        expect(quiet_input).to_be_visible()
        print("- Quiet Offset input visible")

        loud_label = widget.locator("label:has-text('Loud Offset:')")
        expect(loud_label).to_be_visible()
        loud_input = loud_label.locator("input")
        expect(loud_input).to_be_visible()
        print("- Loud Offset input visible")

        # Check default values
        expect(quiet_input).to_have_value("10")
        expect(loud_input).to_have_value("50")
        print("- Default values correct")

        # Take screenshot for visual verification
        page.screenshot(path="verification/noise_meter_verified.png")
        print("Screenshot saved to verification/noise_meter_verified.png")

        browser.close()

if __name__ == "__main__":
    run()
