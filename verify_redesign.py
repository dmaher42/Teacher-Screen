import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    # Ensure the verification directory exists
    os.makedirs("/home/jules/verification", exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        try:
            # Navigate to the local file
            project_root = os.getcwd()
            await page.goto(f"file://{project_root}/index.html")

            # Set a flag to disable modals for verification and clear the rest of the state
            await page.evaluate("() => { localStorage.clear(); localStorage.setItem('isRunningVerification', 'true'); }")

            # Reload the page to apply the testable state
            await page.reload()

            # Wait for the main application container and FAB to be ready
            await page.wait_for_selector(".widgets-container")
            await page.wait_for_selector("#fab")

            # --- Step 1: Add a Timer Widget ---
            # Click the Floating Action Button to open the widget modal
            await page.click("#fab")
            await page.wait_for_selector("#widget-modal[open]")

            # Click the button to add a Timer widget
            await page.click('#widget-modal button[data-widget-type="Timer"]')

            # Wait for the "Timer Added!" notification to appear and disappear
            await page.wait_for_selector(".notification:has-text('Timer Added!')")
            await page.wait_for_selector(".notification", state="detached")

            # Verify the timer widget is on the page
            await page.wait_for_selector(".widget.timer-widget")

            # --- Step 2: Open and Verify Teacher Panel ---
            # Click the "Teacher Controls" button in the top nav
            await page.click("#teacher-controls-toggle")

            # Wait for the panel to be visible
            await page.wait_for_selector(".teacher-panel.open")

            # --- Step 3: Capture final state ---
            await page.screenshot(path="/home/jules/verification/final_redesign_verification.png")

        except Exception as e:
            print(f"An error occurred: {e}")
            # On failure, save the page content for debugging
            page_content = await page.content()
            with open("/home/jules/verification/failure_page_content.html", "w") as f:
                f.write(page_content)
            # Capture a screenshot on error for debugging
            await page.screenshot(path="/home/jules/verification/error_screenshot.png")
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())