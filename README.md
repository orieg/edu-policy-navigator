# edu-policy-navigator

This project provides an accessible, easy-to-understand resource for navigating policies and relevant education code sections for multiple configurable school districts or educational entities. It's implemented as a static website with:

*   **District Selection:** Allows users to choose the specific district they are interested in.
*   **Synthesized Policy Summaries:** Presents simplified summaries of Board Policies (BP), Administrative Regulations (AR), and relevant Education Code sections for the selected district.
*   **AI Chat Interface:** An in-browser chat powered by WebLLM and KuzuDB WASM, allowing users to ask natural language questions and receive contextually relevant answers based *only* on the selected district's data. All processing happens client-side for privacy and efficiency.

The goal is to improve the accessibility and findability of policy information for parents, students, staff, and community members within the configured districts, while ensuring privacy and accuracy. Data collection and site updates are automated via GitHub Actions.

## Getting Started

(Add instructions on how to install dependencies and run the project here)

## Technology Stack

*   **Frontend:** HTML, CSS, JavaScript (ES Modules)
*   **LLM (In-Browser):** WebLLM (mlc-ai)
*   **Graph DB (In-Browser):** KuzuDB WASM
*   **Data Pipeline:** Python 3.x, KuzuDB Python Client, GitHub Actions
*   **LLM (Synthesis - Build Time):** External LLM API (e.g., Google Gemini, OpenAI)
*   **Hosting:** GitHub Pages

## License

This project is licensed under the terms of the [LICENSE](LICENSE) file. 