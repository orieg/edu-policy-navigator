# Project Testing Plan & Methodology

This document outlines the testing strategy, methodology, and tools for the Edu Policy Navigator project. Our goal is to ensure code quality, maintainability, and reliability as the project evolves.

## 1. Overall Testing Strategy

We will adopt a multi-layered testing approach, incorporating:

*   **Unit Tests:** To verify the correctness of individual functions, modules, and small, isolated pieces of logic.
*   **Component Tests:** To test Astro components in isolation, ensuring they render correctly and respond to props and user interactions as expected. (Leveraging Vitest with JSDOM or HappyDOM).
*   **End-to-End (E2E) Tests (Future Consideration):** To simulate real user scenarios by testing complete application flows from the user's perspective.

Our primary reference for testing in an Astro environment is the official [Astro Testing Guide](https://docs.astro.build/en/guides/testing/).

## 2. Testing Tools

*   **Primary Test Runner & Assertion Library:** [Vitest](https://vitest.dev/)
    *   **Reasoning:** Vitest is a Vite-native unit test framework, offering excellent integration with Astro projects (via `astro/config`'s `getViteConfig`), ESM and TypeScript support out-of-the-box, and a familiar Jest-like API. It's also fast due to its use of esbuild.
    *   **Environment:** We will primarily use `jsdom` or `happy-dom` as the test environment for Vitest to simulate a browser environment, which is crucial for testing components and scripts that interact with the DOM.
*   **Component Testing:** Vitest will be used for testing Astro components. Astro's [Container API](https://docs.astro.build/en/guides/testing/#vitest-and-container-api) (experimental as of Astro 4.9) can be used for rendering components to a string or a DOM tree for testing.
*   **E2E Testing (Future):** Tools like [Playwright](https://playwright.dev/) or [Cypress](https://www.cypress.io/) will be considered when we need to implement E2E tests. These are powerful frameworks for automating browser interactions. The Astro documentation provides guidance for both:
    *   [Playwright with Astro](https://docs.astro.build/en/guides/testing/#playwright)
    *   [Cypress with Astro](https://docs.astro.build/en/guides/testing/#cypress)

## 3. Test Organization

*   Test files for unit and component tests will typically reside alongside the code they are testing or in a dedicated `__tests__` subdirectory (e.g., `src/components/__tests__/MyComponent.test.ts` or `src/scripts/utils.test.ts`).
*   Vitest configuration is located in `vitest.config.ts` at the project root.
*   Test scripts are defined in `package.json` (e.g., `pnpm test`, `pnpm test:ui`, `pnpm coverage`).

## 4. Initial Focus Areas for Testing

We will start by adding tests for the following key features and modules:

1.  **Search Functionality (`src/scripts/search.ts`):**
    *   Unit tests for filtering logic (`filterDistricts`).
    *   Unit tests for navigation logic upon selection (`selectDistrict`).
    *   Potentially component tests for the search input and results display if they become complex Astro components.
2.  **Map Functionality (`src/scripts/map.ts` and related components):**
    *   Unit tests for utility functions within `map.ts` (e.g., URL construction, data transformation if any).
    *   Component tests for Astro components that display or interact with the map, mocking Leaflet where necessary or testing DOM structure.
3.  **District/School Pages (`src/pages/districts/[districtSlug].astro`):**
    *   Component tests for individual interactive elements or complex data display components within these pages.
    *   Testing data fetching and rendering logic, potentially using the Astro Container API.
4.  **Core Utility Functions:** Any critical utility functions in `src/lib/` or `src/scripts/` that underpin application logic.
5.  **Policy Browser Components:** If complex components are developed for browsing policies, they will be unit/component tested.

## 5. Test Writing Principles

*   **Clear and Readable:** Tests should be easy to understand. Use descriptive names for test suites and individual tests.
*   **Independent:** Tests should be able to run independently of each other and in any order. Avoid test interdependencies.
*   **Focused:** Each test should verify a specific piece of functionality or behavior.
*   **Repeatable:** Tests should produce the same results every time they are run, given the same code and environment.
*   **Fast:** Aim for fast execution times to encourage frequent running of tests.
*   **AAA Pattern (Arrange, Act, Assert):** Structure tests clearly:
    *   **Arrange:** Set up the necessary preconditions and inputs.
    *   **Act:** Execute the code being tested.
    *   **Assert:** Verify that the outcome is as expected.

## 6. Running Tests

*   **`pnpm test`:** Runs all tests via Vitest in the terminal.
*   **`pnpm test:ui`:** Runs tests with the Vitest UI for a more interactive experience.
*   **`pnpm coverage`:** Runs tests and generates a coverage report.

## 7. Continuous Integration (CI)

Once a solid base of tests is established, we should integrate test execution into our GitHub Actions workflow to ensure that tests pass before merging changes.

This document will be updated as our testing strategy and needs evolve. 