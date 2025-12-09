from playwright.sync_api import sync_playwright, expect

def test_accessibility(page):
    # Load the page from file directly since it's a static site
    import os
    file_path = f"file://{os.getcwd()}/index.html"
    page.goto(file_path)

    # Dismiss tour dialog if present
    tour_dialog = page.locator("#tour-dialog")
    if tour_dialog.is_visible():
        page.get_by_role("button", name="Start Teaching").click()
        expect(tour_dialog).to_be_hidden()

    # 1. Verify Top Nav and Tabs
    top_nav = page.locator("#top-nav")
    expect(top_nav).to_have_attribute("aria-label", "Main sections")

    tablist = page.locator(".nav-tabs")
    expect(tablist).to_have_attribute("role", "tablist")

    # Verify Classroom Tab
    classroom_tab = page.get_by_role("tab", name="Classroom")
    expect(classroom_tab).to_have_attribute("aria-selected", "true")
    expect(classroom_tab).to_have_attribute("aria-controls", "classroom-view")

    # Verify Dashboard Tab (should be unselected)
    dashboard_tab = page.get_by_role("tab", name="Dashboard")
    expect(dashboard_tab).to_have_attribute("aria-selected", "false")
    expect(dashboard_tab).to_have_attribute("aria-controls", "dashboard-view")

    # 2. Verify Panels
    # Classroom panel should be visible
    classroom_panel = page.locator("#classroom-view")
    expect(classroom_panel).to_be_visible()
    expect(classroom_panel).to_have_attribute("role", "tabpanel")

    # Dashboard panel should be hidden
    dashboard_panel = page.locator("#dashboard-view")
    expect(dashboard_panel).to_be_hidden()

    # 3. Test Navigation Logic
    # Click Dashboard
    dashboard_tab.click()

    # Check if attributes updated
    expect(dashboard_tab).to_have_attribute("aria-selected", "true")
    expect(classroom_tab).to_have_attribute("aria-selected", "false")

    # Check panel visibility
    expect(dashboard_panel).to_be_visible()
    expect(classroom_panel).to_be_hidden()

    # Take screenshot of Dashboard view
    page.screenshot(path="verification/dashboard_view.png")

    # Click back to Classroom
    classroom_tab.click()
    expect(classroom_panel).to_be_visible()

    # 4. Verify Student Main Landmark
    student_main = page.locator("#student-main")
    expect(student_main).to_have_role("main")
    expect(student_main).to_have_attribute("aria-label", "Student view")

    # Take screenshot of Classroom view
    page.screenshot(path="verification/classroom_view.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_accessibility(page)
            print("Accessibility verification passed!")
        except Exception as e:
            print(f"Accessibility verification failed: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()
