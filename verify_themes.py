
import asyncio
from playwright.async_api import async_playwright
import os
import time

themes = [
    "light-theme", "dark-theme", "ocean-theme", "forest-theme",
    "sunset-theme", "royal-theme", "monochrome-theme",
    "high-contrast-theme", "memory-cue-theme"
]

base_url = "http://localhost:8000"
output_dir = "/home/jules/verification/themes"
os.makedirs(output_dir, exist_ok=True)

async def capture_theme_screenshot(playwright, theme_id):
    browser = await playwright.chromium.launch()
    context = await browser.new_context()
    page = await context.new_page()

    try:
        await page.goto(base_url)
        await page.evaluate("() => window.localStorage.clear()")
        await page.goto(base_url)

        # Check for and close the welcome tour dialog
        try:
            tour_dialog_button = page.locator('#tour-dialog .modal-primary[data-close]')
            await tour_dialog_button.wait_for(timeout=2000) # Wait up to 2s for it to appear
            if await tour_dialog_button.is_visible():
                await tour_dialog_button.click()
                await asyncio.sleep(0.5) # Wait for dialog to close
        except Exception:
            # If the dialog doesn't appear, that's fine. Continue.
            pass

        await page.evaluate(f"document.body.className = '{theme_id}';")
        await asyncio.sleep(1)

        screenshot_path = os.path.join(output_dir, f"{theme_id}.png")
        await page.screenshot(path=screenshot_path, full_page=True)
        print(f"✅ Successfully captured screenshot for '{theme_id}'")

    except Exception as e:
        print(f"❌ Error capturing screenshot for '{theme_id}': {e}")
    finally:
        await browser.close()

async def main():
    for file in os.listdir(output_dir):
        os.remove(os.path.join(output_dir, file))

    start_time = time.time()

    async with async_playwright() as playwright:
        tasks = [capture_theme_screenshot(playwright, theme) for theme in themes]
        await asyncio.gather(*tasks)

    end_time = time.time()
    print(f"\nVerification complete. All screenshots saved in '{output_dir}'.")
    print(f"Total time: {end_time - start_time:.2f} seconds.")

if __name__ == "__main__":
    asyncio.run(main())
