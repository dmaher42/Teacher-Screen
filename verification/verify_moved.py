
from playwright.sync_api import sync_playwright
import os

def verify_notification_moved():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        cwd = os.getcwd()
        page.goto(f'file://{cwd}/index.html')

        # Close tour if present
        if page.locator('#tour-dialog').is_visible():
            page.locator('#tour-dialog .modal-close').click()

        # Trigger notification
        page.locator('#fab').click()
        page.locator('.widget-category-btn').first.click()

        # Wait for toast
        toast = page.locator('.notification-toast')
        try:
            toast.wait_for(state='visible', timeout=2000)
            print('Toast appeared')
        except:
            print('Toast failed to appear')

        page.screenshot(path='verification/notification_moved.png')
        browser.close()

if __name__ == '__main__':
    verify_notification_moved()
