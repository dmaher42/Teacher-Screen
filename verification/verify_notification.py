
from playwright.sync_api import sync_playwright
import os

def verify_notification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Open the index.html file
        cwd = os.getcwd()
        page.goto(f'file://{cwd}/index.html')

        # Close the tour dialog if it exists
        if page.locator('#tour-dialog').is_visible():
            page.locator('#tour-dialog .modal-close').click()

        # Verify the live region exists
        live_region = page.locator('#live-region')
        if live_region.count() == 0:
            print('Live region not found')
            browser.close()
            return

        print('Live region found')

        # 1. Click FAB to open widget modal
        page.locator('#fab').click()

        # 2. Click on a widget to add it (e.g. Timer)
        # This calls addWidget('timer') which calls showNotification('Timer Added!')
        page.locator('.widget-category-btn').first.click()

        # 3. Check for visible toast
        toast = page.locator('.notification-toast')
        try:
            toast.wait_for(state='visible', timeout=2000)
            print(f'Toast text: {toast.text_content()}')
        except:
            print('Toast did not appear')

        # 4. Check live region text
        # Since updates happen in requestAnimationFrame, we might need to wait a bit
        page.wait_for_timeout(500)
        print(f'Live region text: {live_region.text_content()}')

        # 5. Take screenshot
        page.screenshot(path='verification/notification_test.png')

        browser.close()

if __name__ == '__main__':
    verify_notification()
