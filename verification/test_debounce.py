from playwright.sync_api import sync_playwright
import time
import os

def test_debounce():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the app
        cwd = os.getcwd()
        page.goto(f"file://{cwd}/index.html")

        # Inject code to spy on localStorage.setItem
        # Try a different approach: wrap the specific instance of localStorage
        # Actually, in Chrome, localStorage is a getter on window.
        page.evaluate("""
            const originalSetItem = window.localStorage.setItem;
            window.localStorageWrites = 0;

            // We cannot easily overwrite localStorage.setItem directly if it throws Illegal Invocation when called on wrong 'this'.
            // But we can try to wrap it carefully.

            // Let's spy on the ClassroomScreenApp prototype methods instead?
            // No, we want to verify the effect.

            // What if we just poll localStorage last modified time?
            // Or change the values stored to include a timestamp and count how many times it changes?
            // That's hard if we can't hook the setter.

            // Let's try one more time to hook setItem, binding to localStorage.
            const ls = window.localStorage;
            const orig = ls.setItem.bind(ls);

            Object.defineProperty(ls, 'setItem', {
                writable: true,
                value: function(key, value) {
                    if (key === 'classroomScreenState' || key === 'widgetLayout') {
                        window.localStorageWrites++;
                    }
                    return orig(key, value);
                }
            });
        """)

        # Dismiss tour if present
        if page.is_visible("#tour-dialog"):
            page.click("#tour-dialog .modal-close")

        # Add a widget if none
        if page.locator(".widget").count() == 0:
            page.click("#fab")
            page.get_by_text("Timer").first.click()

        # Locate drag handle or header
        widget_header = page.locator(".widget-header").first
        box = widget_header.bounding_box()

        if box:
            print("Simulating rapid drag...")

            # Reset counter before drag
            page.evaluate("window.localStorageWrites = 0")

            # Mouse down on header
            page.mouse.move(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
            page.mouse.down()

            # Move 50 times rapidly
            for i in range(50):
                page.mouse.move(box["x"] + box["width"]/2 + i, box["y"] + box["height"]/2 + i)

            page.mouse.up()

            # Wait for debounce to settle
            time.sleep(1.0)

            writes = page.evaluate("window.localStorageWrites")
            print(f"Total localStorage writes: {writes}")

            # We expect significantly fewer writes than 50.
            if writes < 10:
                print("SUCCESS: Writes were debounced.")
            else:
                print("FAILURE: Too many writes.")

            page.screenshot(path="verification/debounce_test.png")
        else:
            print("No widget found to drag.")

        browser.close()

if __name__ == "__main__":
    test_debounce()
