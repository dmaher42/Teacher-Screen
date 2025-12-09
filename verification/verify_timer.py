from playwright.sync_api import sync_playwright

def verify_timer_buttons():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        try:
            page.goto("http://localhost:8000")

            # Dismiss tour if present
            try:
                page.wait_for_selector("#tour-dialog", state="visible", timeout=2000)
                page.get_by_role("button", name="Start Teaching").click()
            except:
                pass

            # Open Teacher Panel by clicking Classroom tab (if not already open)
            page.get_by_role("tab", name="Classroom").click()

            # Expand Timer Control
            timer_summary = page.get_by_text("Timer Control")
            if timer_summary.is_visible():
                # Only click if not already expanded (checking visibility of content inside)
                # But summary is always visible.
                # Check for buttons.
                if not page.locator("#timer-preset-5").is_visible():
                    timer_summary.click()

            # Wait for buttons
            page.wait_for_selector("#timer-preset-5")

            # Check if buttons are present and have correct text
            # Use exact=True to avoid partial match (5 min vs 15 min)
            assert page.get_by_role("button", name="5 min", exact=True).is_visible()
            assert page.get_by_role("button", name="10 min", exact=True).is_visible()
            assert page.get_by_role("button", name="15 min", exact=True).is_visible()

            print("Buttons found.")

            # Click 10 min button
            page.get_by_role("button", name="10 min", exact=True).click()

            # Verify input updated
            minutes_val = page.input_value("#timer-minutes")
            print(f"Minutes input value: {minutes_val}")
            assert minutes_val == "10"

            # Take screenshot of the panel with buttons
            page.screenshot(path="verification/timer_verification.png")
            print("Screenshot saved.")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_timer_buttons()
