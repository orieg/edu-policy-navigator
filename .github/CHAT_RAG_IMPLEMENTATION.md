# Chat Widget Implementation Plan

**Goal:** Implement a small, expandable chat widget in the bottom-right corner of the screen. This widget, when clicked, will expand to reveal the main chat interface (`ChatWindow.astro`), which is powered by WebLLM and KuzuDB for a specific school district's policy data.

**Assumptions:**
*   The core chat logic within `ChatWindow.astro` and its backend connections (`ragController.ts`, `kuzudbHandler.ts`, `webllmHandler.ts`) are already planned or implemented as per `IMPLEMENTATION.md`.
*   A testing script is available via `pnpm run test`.

---

**Step-by-Step Implementation Tasks:**

**Phase 1: Component Creation & Basic Structure**

1.  **[ ] Task: Create `ExpandableChatWidget.astro`**
    *   **File:** `src/components/ExpandableChatWidget.astro`
    *   **Content:**
        *   Basic Astro component structure.
        *   Initially, it should render a simple clickable element (e.g., a div with text "Chat" or a placeholder icon) that will serve as the collapsed state of the widget.
        *   This component will later embed `ChatWindow.astro`.
    *   **Testing:** Run `pnpm run test` if applicable, or manually verify the component renders.

2.  **[ ] Task: Prepare `ChatWindow.astro` for Embedding**
    *   **File:** `src/components/ChatWindow.astro`
    *   **Action:** Review and ensure `ChatWindow.astro` is styled and structured in a way that it can be cleanly embedded within another component (`ExpandableChatWidget.astro`).
    *   It should be self-contained or accept necessary props for its functionality if it's to be displayed conditionally.
    *   **Testing:** Run `pnpm run test`.

**Phase 2: Implement Expandable Widget Interactivity**

3.  **[ ] Task: Implement Expand/Collapse Logic**
    *   **File:** `src/components/ExpandableChatWidget.astro`
    *   **Action:**
        *   Add a client-side `<script>` tag.
        *   Implement JavaScript logic to toggle a state (e.g., `isExpanded`) when the clickable element is clicked.
        *   Conditionally render or change the class/style of the embedded `ChatWindow.astro` based on this state. For now, you can use a placeholder for `ChatWindow.astro` if it's not ready to be embedded.
    *   **Testing:** Run `pnpm run test`. Manually test the click to toggle functionality.

4.  **[ ] Task: Embed `ChatWindow.astro`**
    *   **File:** `src/components/ExpandableChatWidget.astro`
    *   **Action:**
        *   Import and embed the actual `ChatWindow.astro` component.
        *   Ensure it's shown only when the widget is in the "expanded" state.
    *   **Testing:** Run `pnpm run test`. Verify `ChatWindow.astro` appears when expanded and disappears when collapsed. Test basic chat functionality if possible.

**Phase 3: Styling and User Experience**

5.  **[ ] Task: Style Collapsed Widget State**
    *   **File:** `src/components/ExpandableChatWidget.astro` (and potentially global CSS in `src/styles/`)
    *   **Action:**
        *   Style the collapsed state of the widget:
            *   Small, fixed position (e.g., bottom-right of the viewport).
            *   Use a clear icon (e.g., chat bubble) or minimal text.
            *   Ensure it has appropriate `z-index` to stay above other content.
    *   **Testing:** Run `pnpm run test`. Visually inspect on different page layouts.

6.  **[ ] Task: Style Expanded Widget State**
    *   **File:** `src/components/ExpandableChatWidget.astro` (and potentially `ChatWindow.astro` styles)
    *   **Action:**
        *   Style the expanded state:
            *   It should appear as a modal or a larger panel, overlaying part of the page.
            *   Ensure `ChatWindow.astro` content is well-formatted and usable within this expanded view.
    *   **Testing:** Run `pnpm run test`. Visually inspect.

7.  **[ ] Task: Add Smooth Transitions**
    *   **File:** `src/components/ExpandableChatWidget.astro` (CSS)
    *   **Action:** Implement CSS transitions or animations for a smoother expand/collapse effect.
    *   **Testing:** Run `pnpm run test`. Visually verify smooth opening and closing.

8.  **[ ] Task: Ensure Responsiveness**
    *   **Files:** `src/components/ExpandableChatWidget.astro`, `src/components/ChatWindow.astro`, relevant CSS.
    *   **Action:** Test and adjust styles so the widget (both collapsed and expanded) looks and functions well on various screen sizes (desktop, tablet, mobile).
    *   **Testing:** Run `pnpm run test`. Manually test on different viewport sizes using browser developer tools.

**Phase 4: Integration and Final Touches**

9.  **[ ] Task: Integrate into Main Layout/Pages**
    *   **File:** `src/layouts/MainLayout.astro` (or specific Astro pages if not global)
    *   **Action:**
        *   Import and add the `<ExpandableChatWidget />` component to the layout.
        *   Ensure it appears on all relevant pages.
    *   **Testing:** Run `pnpm run test`. Navigate through the site to verify the widget is present and functional.

10. **[ ] Task: Accessibility Review**
    *   **File:** `src/components/ExpandableChatWidget.astro`
    *   **Action:**
        *   Ensure the collapsed widget is focusable and can be activated using the keyboard (Enter/Space).
        *   When expanded, manage focus appropriately (e.g., move focus to the chat input field within `ChatWindow.astro`).
        *   When collapsed, return focus to the trigger element or a sensible place.
        *   Add necessary ARIA attributes (e.g., `aria-expanded`, `aria-controls`, role for the button) to enhance accessibility.
    *   **Testing:** Run `pnpm run test`. Perform keyboard-only navigation and use a screen reader if possible.

**Phase 5: Comprehensive Testing**

11. **[ ] Task: Full End-to-End Testing**
    *   **Action:**
        *   Thoroughly test all aspects of the chat widget:
            *   District selection and its effect on the chat context (if `ChatWindow.astro` is already connected to this logic).
            *   Opening and closing the widget.
            *   Sending messages and receiving responses via the WebLLM and KuzuDB backend.
            *   Behavior across different browsers.
            *   Responsiveness on multiple devices/screen sizes.
            *   Accessibility features.
        *   Run `pnpm run test` to catch any regressions.
    *   **Goal:** Ensure the widget is robust, user-friendly, and fully functional.

---

**General Testing Guidance:**
*   Run `pnpm run test` frequently, ideally after completing each task or a set of related sub-tasks.
*   Complement automated tests with manual testing, especially for UI interactions, visual appearance, and user experience.
*   Use browser developer tools to inspect elements, debug scripts, and check for console errors. 