from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # 1. Open App
        page.goto("http://localhost:8000")

        # 2. Dismiss Tour if it appears
        try:
            tour_close = page.locator("#tour-dialog .modal-close")
            tour_close.click(timeout=2000)
        except:
            pass

        # 3. Add Notes Widget
        page.locator("#fab").click()

        # Click Notes Widget button in modal
        # Scope to modal
        page.locator("#widget-modal").get_by_text("Notes", exact=True).click()

        # 4. Find the added widget
        page.wait_for_selector(".widget")
        widgets = page.locator(".widget").all()
        last_widget = widgets[-1]

        # Hover
        last_widget.hover()

        # Click settings button (.widget-settings-btn)
        settings_btn = last_widget.locator(".widget-settings-btn")
        settings_btn.click()

        # 5. Verify Settings Modal
        expect(page.locator("#widget-settings-modal")).to_be_visible()

        # 6. Verify Link Button
        link_btn = page.locator("#link-to-planner-btn")
        expect(link_btn).to_be_visible()
        expect(link_btn).to_have_text("Link to Planner")

        # 7. Click Link Button
        link_btn.click()

        # 8. Verify Planner Modal
        expect(page.locator("#planner-modal")).to_be_visible()
        expect(page.locator("#planner-modal-title")).to_have_text("Weekly Planner")

        # 9. Screenshot
        page.screenshot(path="verification/verification_planner_link.png")
        print("Verification successful, screenshot saved.")

        browser.close()

if __name__ == "__main__":
    run()
