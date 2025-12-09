
from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the local HTML file
        url = 'file://' + os.path.abspath('index.html')
        page.goto(url)

        # Add a widget if none exists (though main.js adds a timer by default if empty)
        # Wait for widget to appear
        page.wait_for_selector('.widget')

        # Focus the widget header
        page.focus('.widget-header')

        # Take a screenshot of initial state
        page.screenshot(path='verification/before_move.png')

        # Press ArrowRight 5 times
        for _ in range(5):
            page.keyboard.press('ArrowRight')

        # Press ArrowDown 2 times
        for _ in range(2):
            page.keyboard.press('ArrowDown')

        # Take a screenshot after move
        page.screenshot(path='verification/after_move.png')

        # Check focus style
        # We can't easily see focus ring in screenshot sometimes depending on OS/Browser,
        # but we can check computed style or trust the CSS.
        # Let's take a screenshot specifically of the focused element area
        box = page.locator('.widget-header').bounding_box()
        if box:
            page.screenshot(path='verification/focus_style.png', clip={
                'x': box['x'] - 5,
                'y': box['y'] - 5,
                'width': box['width'] + 10,
                'height': box['height'] + 10
            })

        browser.close()

if __name__ == '__main__':
    run()
