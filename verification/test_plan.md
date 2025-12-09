# Verification Plan

1.  **Structural Check**: Verify that the `TimerWidget` DOM structure has changed.
    -   It should have a `.widget-display` container.
    -   It should have a `.widget-controls` container.
    -   The `timer-display` element should be inside `.widget-display`.
    -   Controls (buttons, inputs) should be inside `.widget-controls`.

2.  **Visual/Behavioral Check**:
    -   Verify that `.widget-controls` is initially hidden (opacity 0).
    -   Verify that hovering over the widget makes `.widget-controls` visible (opacity 1).
