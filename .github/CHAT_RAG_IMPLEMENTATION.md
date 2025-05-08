# Chat Widget Implementation Plan

**Goal:** Implement a small, expandable chat widget that integrates with an in-browser **Vector Search RAG backend (using e.g., EntityDB, Transformers.js embeddings, and WebLLM)** to provide policy information for a selected school district.

**Strategic Pivot (Date TBD):** Moved away from the initial Graph RAG approach (Text-to-Cypher -> KuzuDB-Wasm) due to significant challenges with LLM brittleness in Cypher generation, potential KuzuDB-Wasm instability in the browser, and the need for very capable (large) LLMs. **Pivoting to Vector Search RAG** using embeddings for semantic context retrieval, aiming for increased robustness and feasibility.

**Assumptions:**
*   **New:** The RAG backend will use vector embeddings for context retrieval.
*   **New:** A suitable embedding model (e.g., from Transformers.js) will be used client-side or embeddings pre-computed in a pipeline.
*   **New:** An in-browser vector database library (e.g., EntityDB) will be used for storing and querying embeddings.
*   **New:** The data pipeline will be adapted to chunk source documents (policies, district info) and generate/store corresponding embeddings.
*   `webllmHandler.ts` (for final answer generation) and state management for `currentDistrictId` are still relevant.
*   A testing script is available via `pnpm run test`.

**Guidance:**
 * When not sure of current implementation, review code in `src/`.
 * Never assume blindly, always confirm current implementation before changing or adding new code.
 * Do not add new framework unless explicitly asked for it.
 * Use our global CSS and shared color palette.

---

**Progress Log / Current Status:**

*   **Initial Setup & Planning:** Established plan, created this file.
*   **Widget UI (`ExpandableChatWidget.astro`, `ChatWindow.astro`):**
    *   Created components, integrated into `BaseLayout.astro`.
    *   Styled using plain CSS and global variables.
    *   Implemented expand/collapse, parent-child communication (custom events, exposed methods).
    *   Ensured `ChatWindow.astro` handles various message types and can control input state.
    *   Troubleshot styling, JS syntax, and communication issues.
    *   Refined initialization messages for better UX (single loading message, updates for WebLLM progress, distinct final system/AI messages).
*   **RAG Backend Handlers (Phase 2.5 - PIVOTED):**
    *   **`kuzudbHandler.ts` (Task 6 - Obsolete):** Implementation abandoned due to pivot.
    *   **`webllmHandler.ts` (Task 7 - Still Relevant):** Core structure for final LLM answer generation remains valid.
*   **`ragController.ts` (Task 8 - Needs Rework):** Initial Graph RAG implementation (Text-to-Cypher, Cypher-to-Context) needs replacement with Vector Search logic.
*   **Backend KuzuDB Generation Pipeline (Task 8.5 - Obsolete):** Script `generateKuzuDB.cjs` is no longer needed. Pipeline requires significant rework for text chunking and embedding generation.
*   **Fixes:** Previous fixes remain relevant.
*   **Pivot Decision:** Decided to switch from Graph RAG to Vector Search RAG due to feasibility issues.

---

**Step-by-Step Implementation Tasks:**

**Phase 1: Core Component Setup & RAG Service Access Strategy**

1.  **[x] Task: Create `ExpandableChatWidget.astro` (Initial Shell)**
    *   **File:** `src/components/ExpandableChatWidget.astro`
    *   **Content:** Basic Astro component structure for the fixed widget container and the clickable toggle button.
    *   **Sub-task:** Determine and document strategy for `ExpandableChatWidget.astro` to access shared RAG state/services (e.g., `ragController`, `currentDistrictId`, instances of KuzuDB/WebLLM). (Decision: Direct instantiation in client script, passing district ID).
    *   **Testing:** Manually verify the basic widget toggle button renders.

2.  **[x] Task: Prepare `ChatWindow.astro` for RAG-Powered Embedding**
    *   **File:** `src/components/ChatWindow.astro`
    *   **Action:** Design, review, or refactor `ChatWindow.astro` to:
        *   Be cleanly embeddable within `ExpandableChatWidget.astro`.
        *   Communicate via events and exposed methods (`addMessage`, `enableInput`).
        *   Internally manage and display UI states for loading/errors. (Enhanced loading/ready messages).
        *   Handle user input submission gracefully.
        *   Display user messages and AI responses.
    *   **Testing:** Mock interaction tested and working.

**Phase 2: Widget UI & Basic Interactivity**

3.  **[x] Task: Implement Expand/Collapse UI Logic for Widget Shell**
    *   **File:** `src/components/ExpandableChatWidget.astro`
    *   **Action:** Implement client-side script to toggle visibility of the expanded window area. Manage `aria-expanded` attributes.
    *   **Testing:** Manually test click-to-toggle functionality of the expanded view.

4.  **[x] Task: Style Collapsed & Expanded Widget Shell**
    *   **File:** `src/components/ExpandableChatWidget.astro`, `src/components/ChatWindow.astro` (using plain CSS with global variables)
    *   **Action:** Style the collapsed state (chat toggle button) and the expanded state (window frame, including `ChatWindow` content like header, messages, input area).
    *   **Testing:** Visually inspect styles and animations. Ensure use of global color palette. (Message bubble styling achieved).

5.  **[x] Task: Add Smooth Transitions for Expand/Collapse**
    *   **File:** `src/components/ExpandableChatWidget.astro` (CSS)
    *   **Action:** Implement CSS transitions for a smoother visual effect when the chat window opens and closes.
    *   **Testing:** Visually verify smooth opening and closing animations.

**Phase 2.5: RAG Backend Core Implementation (OLD - Graph RAG)**

6.  **[!] Task: Implement `kuzudbHandler.ts`** (Obsolete due to Pivot)
    *   ~File: `src/lib/kuzudbHandler.ts`~
    *   ~Action: Logic for loading/querying KuzuDB.~~\n    *   ~Dependencies: KuzuDB-Wasm library.~~\n\n7.  **[~] Task: Implement `webllmHandler.ts`** (Core structure complete, types exported - Still needed for final LLM)\n    *   File: `src/lib/webllmHandler.ts`\n    *   Action: Logic for initializing WebLLM engine and providing `chatCompletion`.
    *   Dependencies: WebLLM library (`@mlc-ai/web-llm`).

8.  **[!] Task: Implement `ragController.ts` (Graph RAG version)** (Needs Rework for Vector RAG)
    *   ~File: `src/lib/ragController.ts`~
    *   ~Action: Text-to-Cypher, Cypher-to-Context, Context-to-Answer logic.~~
    *   ~Dependencies: `kuzudbHandler.ts`, `webllmHandler.ts`.~~

8.5 **[!] Task: Implement Backend KuzuDB Generation Pipeline** (Obsolete due to Pivot)
    *   ~Files: `pipeline/scripts/generateKuzuDB.cjs`, `package.json`~
    *   ~Action: Generate KuzuDB `.db` file from source JSONs.~~

**Phase 2.5b: Vector Search RAG Backend Implementation (NEW)**

**[x] Task: Cleanup Task (P0): Remove Obsolete KuzuDB/Graph RAG Components**
    *   **Action:** Executed the following cleanup steps:
        *   Removed `kuzu` and `kuzu-wasm` dependencies using `pnpm remove`.
        *   Deleted `src/lib/kuzudbHandler.ts`.
        *   Deleted `pipeline/scripts/generateKuzuDB.cjs`.
        *   Deleted `src/kuzu-wasm.d.ts`.
        *   Deleted `public/kuzu_dbs/` directory.
        *   Updated `package.json`:
            *   Removed the `build:kuzu` script.
            *   Removed `&& pnpm run build:kuzu` from `prepare` and `dev` scripts.
            *   Removed `"kuzu"` from `keywords`.
            *   Removed `kuzu`-related entries from the `pnpm` configuration object.
            *   Removed `public/kuzu_dbs` from the `clean` script.
        *   Note: The sub-task "Update `vite.config.ts`: remove the `kuzu_wasm_worker.js` target from `viteStaticCopy` plugin config" was not performed as this configuration was not found or identified as needing removal during the previous steps.

6b. **[ ] Task: Implement Text Processing & Embedding Pipeline**
    *   Files: New pipeline script(s) (e.g., `pipeline/scripts/generateEmbeddings.js`),
    *   Action: Read source data (policies, district info - requires obtaining/parsing these), implement text chunking, integrate embedding model (e.g., Transformers.js Node), generate embeddings, save chunks + embeddings (e.g., to JSON files in `public/embeddings/`).
    *   Dependencies: Node.js, file system access, text parsing libs (e.g., pdf-parse), embedding library.

7b. **[x] Task: Implement Client-Side Vector DB Handler (e.g., EntityDBWrapper)**
    *   File: New `src/lib/vectorDbHandler.ts` (or similar).
    *   Action: Wrapped EntityDB library. Implemented initialization (loading pre-computed data from `public/embeddings/embedded_data.json`), querying based on embedding vector, error handling.
    *   Dependencies: Vector DB library (`@babycommando/entity-db`).
    *   Added `src/types/entity-db.d.ts` for module declaration.

8b. **[x] Task: Refactor `ragController.ts` for Vector RAG**
    *   File: `src/lib/ragController.ts`
    *   Action:
        *   Removed old Text-to-Cypher and Cypher-to-Context logic.
        *   Integrated with `vectorDbHandler.ts`.
        *   Added client-side query embedding generation using `@xenova/transformers` (`Snowflake/snowflake-arctic-embed-xs`).
        *   Implemented lazy/cached loading for the embedding model.
        *   Implemented lazy/cached loading for the Vector DB data via `vectorDbHandler.initialize`.
        *   The main `processQuery` method now orchestrates: Lazy init of embedding model & vector DB -> Query Embedding -> Vector Search -> Context Compilation -> LLM Answer.
        *   Updated `_contextToAnswer` with a more robust prompt for context-only answers.
        *   Fallbacks to general LLM knowledge if no context is found.
        *   Status: Refactoring complete. Resolved several runtime issues related to library usage, base URLs, and data loading.
        *   **Note:** Encountering persistent runtime errors within `EntityDB.queryManualVectors` / `EntityDB.query` even after successful data loading. Further debugging or library alternative may be needed.
    *   Dependencies: `vectorDbHandler.ts`, `webllmHandler.ts`, `@xenova/transformers`.

**Phase 3: RAG Integration & Full `ChatWindow.astro` Functionality**

9.  **[x] Task: Embed RAG-Ready `ChatWindow.astro` & Pass Dependencies/Setup Events** (Structure is reusable)

10. **[ ] Task: Implement Core Chat Logic via Refactored `ragController`**
    *   File: `src/components/ExpandableChatWidget.astro` (handler for chat events).
    *   Action:
        *   Update initialization logic for new RAG services (Embedding model, Vector DB).
        *   Call refactored `ragController.processQuery(...)`.
        *   Ensure `ChatWindow.astro` displays responses/states correctly via `progressCallback`.
    *   Testing: Test with the actual Vector RAG pipeline.

11. **[ ] Task: Verify Dynamic RAG Backend Initialization and Context Switching**
    *   Files: Relevant layout/state files, `ExpandableChatWidget.astro`, `ChatWindow.astro`, new RAG handlers.
    *   Action:
        *   Implement actual `currentDistrictId` selection logic (needed if embeddings are district-specific).
        *   Confirm correct Vector DB data is loaded/queried based on context.
        *   Test chat functionality after changing districts (if applicable).
    *   Testing: Manually switch districts (if applicable); perform test queries. Monitor console/network.

**Phase 4: Final Touches & System-Wide Testing**

12. **[x] Task: Integrate into Main Layout**
    *   **File:** `src/layouts/BaseLayout.astro`
    *   **Action:** Ensured `<ExpandableChatWidget />` is correctly configured.
    *   **Testing:** Verify widget presence across site pages.

13. **[ ] Task: Ensure Responsiveness**
    *   **Files:** `ExpandableChatWidget.astro`, `ChatWindow.astro`, CSS.
    *   **Action:** Adjust styles for various screen sizes.
    *   **Testing:** Manual viewport testing. Automated UI tests if any.

14. **[ ] Task: Accessibility Review & Enhancements**
    *   **File:** `ExpandableChatWidget.astro`, `ChatWindow.astro`
    *   **Action:** Thorough keyboard navigation review, ARIA attributes, screen reader testing, color contrast.
    *   **Testing:** Manual keyboard/screen reader tests. Automated accessibility checks.

15. **[ ] Task: Full End-to-End RAG and UI Testing**
    *   Action: Comprehensive testing covering:
        *   District selection and correct RAG context loading (Vector DB).
        *   Widget UI/UX.
        *   **Query Complexity & Performance: Test with simple and complex natural language questions. Evaluate context relevance from Vector DB and final answer quality. Ensure UI handles delays gracefully.**
        *   **RAG Error Handling: Test scenarios where embedding generation fails, vector search returns no results, or LLM answer generation issues.**
        *   UI behavior with long messages, multiple messages.
        *   Cross-browser compatibility.
    *   Goal: Ensure a robust, user-friendly, accessible, and functional chat widget with the **Vector RAG** backend.

---

**Next Steps (Focus Areas - NEW):**

1.  **Implement Vector Pipeline (Task 6b):** Define sources for policy text, choose chunking strategy, integrate embedding model, output data for client.
2.  **Implement Client Vector Handling (Task 7b):** Integrate EntityDB (or alternative), load data, implement query logic.
3.  **Refactor `ragController` (Task 8b):** Adapt controller to use embedding/vector search for context.
4.  **Integrate & Test (Task 10):** Connect refactored controller to UI, perform end-to-end tests.
5.  **Implement `currentDistrictId` Selection (Task 11):** If vector data is per-district, implement logic to switch context.

---

**General Testing Guidance:**
*   Run `pnpm run test` frequently.
*   Complement with manual testing for UI, UX, and **Vector RAG** functionality.
*   Use browser developer tools extensively.

---

**Phase X: Potential Enhancements & Long-Term Considerations (Post-MVP)**

*   **State Management Reactivity (Astro Specific):**
    *   If using a global state store (e.g., `src/lib/state.ts`), thoroughly review and test how Astro components (`