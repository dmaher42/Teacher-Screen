from playwright.sync_api import sync_playwright
import time
import os

def test_debounce_verify():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        cwd = os.getcwd()
        page.goto(f"file://{cwd}/index.html")

        page.evaluate("""
            const ls = window.localStorage;
            const orig = ls.setItem.bind(ls);
            window.localStorageWrites = 0;

            Object.defineProperty(ls, 'setItem', {
                writable: true,
                value: function(key, value) {
                    if (key === 'classroomScreenState' || key === 'widgetLayout' || key === 'testKey') {
                        window.localStorageWrites++;
                    }
                    return orig(key, value);
                }
            });
        """)

        # Test the spy
        page.evaluate("localStorage.setItem('testKey', 'testValue')")
        writes = page.evaluate("window.localStorageWrites")
        print(f"Test writes: {writes}")

        if writes != 1:
            print("Spy failed to detect write.")
            browser.close()
            return

        # Now simulate drag
        if page.is_visible("#tour-dialog"):
            page.click("#tour-dialog .modal-close")
        if page.locator(".widget").count() == 0:
            page.click("#fab")
            page.get_by_text("Timer").first.click()

        widget_header = page.locator(".widget-header").first
        box = widget_header.bounding_box()

        if box:
            print("Simulating rapid drag...")
            page.evaluate("window.localStorageWrites = 0")

            page.mouse.move(box["x"] + box["width"]/2, box["y"] + box["height"]/2)
            page.mouse.down()

            for i in range(50):
                page.mouse.move(box["x"] + box["width"]/2 + i, box["y"] + box["height"]/2 + i)
            page.mouse.up()

            time.sleep(1.0)

            writes = page.evaluate("window.localStorageWrites")
            print(f"Total localStorage writes: {writes}")

            if 0 < writes < 10:
                print("SUCCESS: Writes were debounced (count > 0 and < 10).")
            elif writes == 0:
                 print("WARNING: Writes were 0. Maybe debounce delay too long or save not triggered?")
            else:
                print("FAILURE: Too many writes.")

        browser.close()

if __name__ == "__main__":
    test_debounce_verify()
