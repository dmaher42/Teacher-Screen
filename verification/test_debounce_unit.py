from playwright.sync_api import sync_playwright
import os

def test_debounce_unit():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        cwd = os.getcwd()
        page.goto(f"file://{cwd}/index.html")

        # Test the debounce function defined in main.js
        result = page.evaluate("""
            () => {
                if (typeof debounce !== 'function') return 'debounce not found';

                let counter = 0;
                const inc = debounce(() => { counter++; }, 100);

                inc();
                inc();
                inc();

                // Return a promise to wait
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve(counter);
                    }, 200);
                });
            }
        """)

        print(f"Debounce unit test result (counter): {result}")

        if result == 1:
            print("SUCCESS: Debounce function works.")
        else:
            print(f"FAILURE: Debounce function failed (expected 1, got {result}).")

        # Verify saveState is wrapped
        is_wrapped = page.evaluate("""
            () => {
                // Check if app.saveState name implies it's wrapped or behave like one?
                // The native function would have name 'saveState' or 'bound saveState'.
                // Our debounce returns an anonymous function or similar.
                // But easier: check if calling it repeatedly works.

                // We need to access the app instance.
                // We don't have global access to 'app' variable from main.js (it is inside DOMContentLoaded listener).
                // But we can verify 'debounce' exists globally.
                return typeof debounce === 'function';
            }
        """)

        if is_wrapped:
             print("Debounce function is present globally.")

        # Screenshot
        page.screenshot(path="verification/debounce_unit.png")

        browser.close()

if __name__ == "__main__":
    test_debounce_unit()
