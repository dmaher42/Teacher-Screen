from playwright.sync_api import sync_playwright

def verify_widget_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app
        page.goto('http://localhost:8000/index.html')

        # Wait for app to load and tour to close if any (or we might need to close it)
        try:
            page.wait_for_selector('#tour-dialog', state='visible', timeout=2000)
            page.click('#tour-dialog .modal-close')
        except:
            pass

        # Ensure a timer widget exists
        if page.locator('.timer-widget').count() == 0:
            pass # Should exist by default

        # Hover over the widget
        widget = page.locator('.timer-widget').first
        widget.hover()

        # Wait for settings button to appear
        settings_btn = widget.locator('.widget-settings-btn')
        settings_btn.wait_for(state='visible')

        # Take screenshot of the widget with settings button visible
        page.screenshot(path='/home/jules/verification/widget_hover.png', clip=widget.bounding_box())

        # Click settings button
        settings_btn.click()

        # Verify settings modal opens
        page.wait_for_selector('#widget-settings-modal.visible')

        # Check for new controls: Remove Widget, Projector Toggle, Help
        page.locator('text=Remove Widget').wait_for()
        page.locator('text=Help / Info').wait_for()

        # Use more specific selector for projector button inside the modal
        # It's a button with class 'control-button' inside the modal-body or modal-common-controls
        modal = page.locator('#widget-settings-modal')
        projector_btn = modal.locator('button', has_text='Projector')
        projector_btn.wait_for()

        # Take screenshot of modal
        page.screenshot(path='/home/jules/verification/settings_modal.png')

        browser.close()

if __name__ == "__main__":
    verify_widget_ui()
