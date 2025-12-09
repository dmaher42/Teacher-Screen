from playwright.sync_api import sync_playwright, expect
import time

def verify_widget_interaction():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # 1. Navigate to the app
        page.goto('http://localhost:8080/index.html')

        # 2. Dismiss tour if present
        try:
            page.get_by_role('button', name='Start Teaching').click(timeout=2000)
            print("Dismissed tour")
        except:
            print("Tour not found or already dismissed")

        # 3. Add a Timer Widget if not present (default should be present, but let's be safe)
        # Check for widget
        widget = page.locator('.timer-widget').first
        if not widget.is_visible():
            print("Adding Timer Widget")
            page.get_by_role('button', name='Add Widget').click() # FAB?
            # Actually FAB is +, but we can also use the widget selector in top toolbar if open?
            # Let's try FAB
            page.locator('#fab').click()
            page.get_by_role('button', name='Timer').click()
            widget = page.locator('.timer-widget').first

        # 4. Hover over widget to see settings button
        print("Hovering over widget")
        widget.hover()

        settings_btn = widget.locator('.widget-settings-btn')
        expect(settings_btn).to_be_visible()

        # Take screenshot of hover state
        page.screenshot(path='verification/verification_hover.png')

        # 5. Click settings button
        print("Clicking settings button")
        settings_btn.click()

        # 6. Verify Modal is open
        modal = page.locator('#widget-settings-modal')
        expect(modal).to_be_visible()
        expect(modal.locator('.modal-title')).to_contain_text('Timer Settings')

        # 7. Verify controls in modal
        # Start button should be visible in modal
        start_btn = modal.locator('button', has_text='Start')
        expect(start_btn).to_be_visible()

        # Take screenshot of open modal
        page.screenshot(path='verification/verification_modal.png')
        print("Screenshots taken")

        browser.close()

if __name__ == "__main__":
    verify_widget_interaction()
