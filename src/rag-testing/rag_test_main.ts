console.log("RAG Test Main: Script loaded.");

// Import the worker using Vite's ?worker syntax
import RagWorker from '/src/rag-testing/rag_worker.ts?worker';
// Dynamically import transformers.js for in-browser use
import { pipeline, env as CjsEnv } from '@huggingface/transformers';

interface SimilaritySampleData {
    id: string;
    text1: string;
    text2: string;
    embedding1?: number[];
    embedding2?: number[];
    transformersJsSimilarity: number | null; // Pre-computed from Node.js
}

let similarityValidationSamples: SimilaritySampleData[] = [];

// Helper for cosine similarity (dot product of L2 normalized vectors)
function calculateCosineSimilarity(vecA: number[] | Float32Array, vecB: number[] | Float32Array): number {
    if (vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct; // Assumes vectors are already L2 normalized
}

// L2 Normalization function (if needed, transformers.js pipeline should handle it with normalize:true)
function normalizeL2(vector: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return vector; // Avoid division by zero
    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
        normalized[i] = vector[i] / norm;
    }
    return normalized;
}

// Utility to escape HTML for safe display
function escapeHtml(str: string): string {
    if (!str) return '';
    const escaped = str.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    console.log("Before escaping:", str.substring(0, 200) + (str.length > 200 ? '...' : ''));
    console.log("After escaping:", escaped.substring(0, 200) + (escaped.length > 200 ? '...' : ''));
    return escaped;
}

// Highlight <think> blocks using more flexible regex patterns
function highlightThinkBlocks(str: string): string {
    if (!str) return '';

    // Match <think> tags (including variations with spaces, case differences)
    // This will catch:
    // <think>...</think>
    // < think >...</ think >
    // <THINK>...</THINK>
    const thinkPattern = /&lt;\s*think\s*&gt;([\s\S]*?)&lt;\s*\/\s*think\s*&gt;/gi;

    // First, check if there are any <think> tags in the escaped string
    const hasThinkTags = thinkPattern.test(str);
    console.log("Contains <think> tags:", hasThinkTags);

    // Reset regex lastIndex since we used test() above
    thinkPattern.lastIndex = 0;

    // Apply highlighting to matched <think> tags
    const highlighted = hasThinkTags ?
        str.replace(thinkPattern, '<span style="background: #ffeeba; color: #856404; border-radius: 3px; padding: 2px 4px;">$&</span>') :
        str;

    // Show the final highlighted string for debugging
    if (hasThinkTags) {
        console.log("After highlighting:", highlighted.substring(0, 200) + (highlighted.length > 200 ? '...' : ''));
    }

    return highlighted;
}

document.addEventListener('DOMContentLoaded', async () => {
    const queryInput = document.getElementById('queryInput') as HTMLTextAreaElement;
    const systemPromptInput = document.getElementById('systemPromptInput') as HTMLTextAreaElement;
    const rephrasePromptTemplateInput = document.getElementById('rephrasePromptTemplateInput') as HTMLTextAreaElement;
    const finalRagPromptTemplateInput = document.getElementById('finalRagPromptTemplateInput') as HTMLTextAreaElement;
    const submitQueryBtn = document.getElementById('submitQueryBtn') as HTMLButtonElement;
    const responseArea = document.getElementById('responseArea') as HTMLDivElement;
    const statusLabel = document.getElementById('statusLabel') as HTMLDivElement;
    const progressBarContainer = document.getElementById('progressBarContainer') as HTMLDivElement;
    const progressBar = document.getElementById('progressBar') as HTMLDivElement;

    // New UI elements for similarity test
    const runSimilarityTestBtn = document.getElementById('runSimilarityTestBtn') as HTMLButtonElement;
    const similarityResultsArea = document.getElementById('similarityResultsArea') as HTMLDivElement;

    // New UI elements for step-by-step RAG
    const rephraseQueryBtn = document.getElementById('rephraseQueryBtn') as HTMLButtonElement;
    const rephrasedQueryArea = document.getElementById('rephrasedQueryArea') as HTMLDivElement;
    const retrieveContextBtn = document.getElementById('retrieveContextBtn') as HTMLButtonElement;
    const retrievedContextArea = document.getElementById('retrievedContextArea') as HTMLDivElement;
    const generateFinalAnswerBtn = document.getElementById('generateFinalAnswerBtn') as HTMLButtonElement;

    // New context score slider UI
    const minContextScoreSlider = document.getElementById('minContextScoreSlider') as HTMLInputElement;
    const minContextScoreValue = document.getElementById('minContextScoreValue') as HTMLSpanElement;

    // Chat model config UI
    const chatEngineWebLLMRadio = document.getElementById('chatEngineWebLLM') as HTMLInputElement;
    const chatEngineTransformersJSDefaultRadio = document.getElementById('chatEngineTransformersJSDefault') as HTMLInputElement;
    const chatEnginePleiasRAGRadio = document.getElementById('chatEnginePleiasRAG') as HTMLInputElement;
    const transformersModelInputDiv = document.getElementById('transformersModelInputDiv') as HTMLDivElement;
    const transformersModelInput = document.getElementById('transformersModelInput') as HTMLInputElement;

    // New rephrase and answer settings UI
    const rephraseTemperatureSlider = document.getElementById('rephraseTemperatureSlider') as HTMLInputElement;
    const rephraseTemperatureValue = document.getElementById('rephraseTemperatureValue') as HTMLSpanElement;
    const rephraseTopPSlider = document.getElementById('rephraseTopPSlider') as HTMLInputElement;
    const rephraseTopPValue = document.getElementById('rephraseTopPValue') as HTMLSpanElement;
    const rephraseTopKInput = document.getElementById('rephraseTopKInput') as HTMLInputElement;
    const rephraseMaxNewTokensInput = document.getElementById('rephraseMaxNewTokensInput') as HTMLInputElement;
    const answerTemperatureSlider = document.getElementById('answerTemperatureSlider') as HTMLInputElement;
    const answerTemperatureValue = document.getElementById('answerTemperatureValue') as HTMLSpanElement;
    const answerTopPSlider = document.getElementById('answerTopPSlider') as HTMLInputElement;
    const answerTopPValue = document.getElementById('answerTopPValue') as HTMLSpanElement;
    const answerTopKInput = document.getElementById('answerTopKInput') as HTMLInputElement;
    const answerMaxNewTokensInput = document.getElementById('answerMaxNewTokensInput') as HTMLInputElement;

    // New ONNX file input
    const transformersOnnxFileInput = document.getElementById('transformersOnnxFileInput') as HTMLInputElement;

    // --- Element Existence Check ---
    const requiredElements: { [key: string]: HTMLElement | null } = {
        queryInput,
        systemPromptInput,
        rephrasePromptTemplateInput,
        finalRagPromptTemplateInput,
        submitQueryBtn,
        responseArea,
        statusLabel,
        progressBarContainer,
        progressBar,
        runSimilarityTestBtn,
        similarityResultsArea,
        rephraseQueryBtn,
        rephrasedQueryArea,
        retrieveContextBtn,
        retrievedContextArea,
        generateFinalAnswerBtn,
        chatEngineWebLLMRadio,
        chatEngineTransformersJSDefaultRadio,
        chatEnginePleiasRAGRadio,
        transformersModelInputDiv,
        transformersModelInput,
        rephraseTemperatureSlider,
        rephraseTemperatureValue,
        rephraseTopPSlider,
        rephraseTopPValue,
        rephraseTopKInput,
        rephraseMaxNewTokensInput,
        answerTemperatureSlider,
        answerTemperatureValue,
        answerTopPSlider,
        answerTopPValue,
        answerTopKInput,
        answerMaxNewTokensInput,
        transformersOnnxFileInput,
        minContextScoreSlider,
        minContextScoreValue
    };

    for (const [name, element] of Object.entries(requiredElements)) {
        if (!element) {
            throw new Error(`Initialization Error: Failed to find required DOM element with ID corresponding to variable '${name}'. Check HTML structure and IDs.`);
        }
    }

    let worker: Worker | undefined;
    let inBrowserExtractor: any = null; // For in-browser transformers.js pipeline

    // Intermediate state for step-by-step RAG
    let currentRephrasedQuery: string | null = null;
    let currentRetrievedContext: string | null = null;
    let currentOriginalQuery: string | null = null;

    // Store default prompt template values
    let defaultRephraseTemplate = '';
    let defaultFinalRagTemplate = '';

    // Store default model generation settings values
    let defaultAnswerSettings = {
        temperature: "0.6", // From initial Qwen3 HTML setup
        top_p: "0.95",      // From initial Qwen3 HTML setup
        top_k: "20",        // From initial Qwen3 HTML setup
        max_new_tokens: "32768" // From initial Qwen3 HTML setup
    };
    let defaultRephraseSettings = {
        temperature: "0.6", // From initial Qwen3 HTML setup (mirrored)
        top_p: "0.95",      // From initial Qwen3 HTML setup (mirrored)
        top_k: "20",        // From initial Qwen3 HTML setup (mirrored)
        max_new_tokens: "32768" // From initial Qwen3 HTML setup (mirrored)
    };

    // Fetch similarity validation samples
    try {
        const response = await fetch('/embeddings/similarity_validation_samples.json');
        if (!response.ok) {
            throw new Error(`Failed to fetch similarity_validation_samples.json: ${response.statusText}`);
        }
        similarityValidationSamples = await response.json();
        console.log("RAG Test Main: Similarity validation samples loaded.", similarityValidationSamples);
        if (runSimilarityTestBtn) runSimilarityTestBtn.disabled = false; // Enable button once samples are loaded
    } catch (error) {
        console.error("RAG Test Main: Error loading similarity validation samples:", error);
        if (similarityResultsArea) similarityResultsArea.innerHTML = `<p style="color:red;">Error loading similarity samples: ${error instanceof Error ? error.message : String(error)}</p>`;
        if (runSimilarityTestBtn) runSimilarityTestBtn.disabled = true;
    }

    // Update display values for sliders
    if (rephraseTemperatureSlider && rephraseTemperatureValue) {
        rephraseTemperatureSlider.addEventListener('input', () => {
            rephraseTemperatureValue.textContent = rephraseTemperatureSlider.value;
        });
        rephraseTemperatureValue.textContent = rephraseTemperatureSlider.value;
    }
    if (rephraseTopPSlider && rephraseTopPValue) {
        rephraseTopPSlider.addEventListener('input', () => {
            rephraseTopPValue.textContent = rephraseTopPSlider.value;
        });
        rephraseTopPValue.textContent = rephraseTopPSlider.value;
    }
    if (answerTemperatureSlider && answerTemperatureValue) {
        answerTemperatureSlider.addEventListener('input', () => {
            answerTemperatureValue.textContent = answerTemperatureSlider.value;
        });
        answerTemperatureValue.textContent = answerTemperatureSlider.value;
    }
    if (answerTopPSlider && answerTopPValue) {
        answerTopPSlider.addEventListener('input', () => {
            answerTopPValue.textContent = answerTopPSlider.value;
        });
        answerTopPValue.textContent = answerTopPSlider.value;
    }

    // Listener for the new context score slider
    if (minContextScoreSlider && minContextScoreValue) {
        minContextScoreSlider.addEventListener('input', () => {
            minContextScoreValue.textContent = minContextScoreSlider.value;
        });
        minContextScoreValue.textContent = minContextScoreSlider.value; // Set initial display
    }

    // --- Helper to get parent container and header for settings sections ---+
    function getSettingsSectionElements(element: HTMLElement | null): { container: Element | null | undefined, header: HTMLHeadingElement | null | undefined } {
        const container = element?.closest('div[style*="flex: 1"]'); // Find the parent div
        const header = container?.querySelector('h4'); // Find the h4 within it
        return { container, header };
    }

    // --- Helper function to update model generation settings in UI ---+
    function updateGenerationSettingsUI(isPleias: boolean) {
        const pleiasPhase1Defaults = {
            temperature: "0.0",
            top_p: "0.95", // Assuming same as phase 3 based on library defaults
            top_k: "0", // Assuming same as phase 3 based on library defaults
            max_new_tokens: "200" // Specific to phase 1
        };
        const pleiasPhase3Defaults = {
            temperature: "0.0",
            top_p: "0.95",
            top_k: "0",
            max_new_tokens: "2048" // Specific to phase 3
        };

        const { container: rephraseSettingsContainer, header: rephraseHeader } = getSettingsSectionElements(rephraseTemperatureSlider);
        const { container: answerSettingsContainer, header: answerHeader } = getSettingsSectionElements(answerTemperatureSlider);

        if (isPleias) {
            // Configure "Phase 3: Answer Generation Settings" (originally Answer settings)
            if (answerHeader) answerHeader.textContent = 'Phase 3: Answer Generation Settings';
            if (answerSettingsContainer) (answerSettingsContainer as HTMLElement).style.display = 'block';

            answerTemperatureSlider.value = pleiasPhase3Defaults.temperature;
            answerTemperatureValue.textContent = pleiasPhase3Defaults.temperature;
            answerTemperatureSlider.disabled = submitQueryBtn.disabled;

            answerTopPSlider.value = pleiasPhase3Defaults.top_p;
            answerTopPValue.textContent = pleiasPhase3Defaults.top_p;
            answerTopPSlider.disabled = submitQueryBtn.disabled;

            answerTopKInput.value = pleiasPhase3Defaults.top_k;
            answerTopKInput.disabled = submitQueryBtn.disabled;

            answerMaxNewTokensInput.value = pleiasPhase3Defaults.max_new_tokens;
            answerMaxNewTokensInput.max = "4096"; // Keep max high, but default lower
            answerMaxNewTokensInput.disabled = submitQueryBtn.disabled;

            // Configure "Phase 1: Query Reformulation Settings" (originally Rephrase settings)
            if (rephraseHeader) rephraseHeader.textContent = 'Phase 1: Query Reformulation Settings';
            if (rephraseSettingsContainer) (rephraseSettingsContainer as HTMLElement).style.display = 'block';

            rephraseTemperatureSlider.value = pleiasPhase1Defaults.temperature;
            rephraseTemperatureValue.textContent = pleiasPhase1Defaults.temperature;
            rephraseTemperatureSlider.disabled = submitQueryBtn.disabled;

            rephraseTopPSlider.value = pleiasPhase1Defaults.top_p;
            rephraseTopPValue.textContent = pleiasPhase1Defaults.top_p;
            rephraseTopPSlider.disabled = submitQueryBtn.disabled;

            rephraseTopKInput.value = pleiasPhase1Defaults.top_k;
            rephraseTopKInput.disabled = submitQueryBtn.disabled;

            rephraseMaxNewTokensInput.value = pleiasPhase1Defaults.max_new_tokens;
            rephraseMaxNewTokensInput.max = "512"; // Lower max for reformulation phase
            rephraseMaxNewTokensInput.disabled = submitQueryBtn.disabled;

        } else {
            // Restore original labels and settings
            if (answerHeader) answerHeader.textContent = 'Chat Answer Model Settings';
            if (rephraseHeader) rephraseHeader.textContent = 'Rephrase Model Settings';

            // Restore Answer settings
            answerTemperatureSlider.value = defaultAnswerSettings.temperature;
            answerTemperatureValue.textContent = defaultAnswerSettings.temperature;
            answerTemperatureSlider.disabled = submitQueryBtn.disabled;

            answerTopPSlider.value = defaultAnswerSettings.top_p;
            answerTopPValue.textContent = defaultAnswerSettings.top_p;
            answerTopPSlider.disabled = submitQueryBtn.disabled;

            answerTopKInput.value = defaultAnswerSettings.top_k;
            answerTopKInput.disabled = submitQueryBtn.disabled;

            answerMaxNewTokensInput.value = defaultAnswerSettings.max_new_tokens;
            answerMaxNewTokensInput.max = "32768"; // Restore original higher max
            answerMaxNewTokensInput.disabled = submitQueryBtn.disabled;

            // Restore Rephrase settings
            if (rephraseSettingsContainer) (rephraseSettingsContainer as HTMLElement).style.display = 'block'; // or original display
            rephraseTemperatureSlider.disabled = submitQueryBtn.disabled;
            rephraseTemperatureSlider.value = defaultRephraseSettings.temperature;
            rephraseTemperatureValue.textContent = defaultRephraseSettings.temperature;

            rephraseTopPSlider.disabled = submitQueryBtn.disabled;
            rephraseTopPSlider.value = defaultRephraseSettings.top_p;
            rephraseTopPValue.textContent = defaultRephraseSettings.top_p;

            rephraseTopKInput.disabled = submitQueryBtn.disabled;
            rephraseTopKInput.value = defaultRephraseSettings.top_k;

            rephraseMaxNewTokensInput.disabled = submitQueryBtn.disabled;
            rephraseMaxNewTokensInput.value = defaultRephraseSettings.max_new_tokens;
            rephraseMaxNewTokensInput.max = "32768"; // Restore original higher max
        }
    }

    // Helper function to update prompt templates
    function updatePromptTemplates(isPleias: boolean) {
        const pleiasFinalRagUITemplate = `<|query_start|>{query}<|query_end|>\n{context}\n<|source_analysis_start|>\n`;
        const pleiasRephraseUITemplate = `<|query_start|>{query}<|query_end|>\n<|source_analysis_start|>\n`;

        const systemPromptContainer = systemPromptInput.parentElement;
        const rephraseContainer = rephrasePromptTemplateInput.parentElement;

        if (isPleias) {
            if (systemPromptContainer) systemPromptContainer.style.display = 'none';
            systemPromptInput.disabled = true;

            if (rephraseContainer) rephraseContainer.style.display = 'block';
            rephrasePromptTemplateInput.value = pleiasRephraseUITemplate;
            rephrasePromptTemplateInput.disabled = true;

            finalRagPromptTemplateInput.value = pleiasFinalRagUITemplate;
            finalRagPromptTemplateInput.disabled = true;
        } else {
            if (systemPromptContainer) systemPromptContainer.style.display = 'block';
            systemPromptInput.disabled = submitQueryBtn.disabled;

            if (rephraseContainer) rephraseContainer.style.display = 'block';
            if (defaultRephraseTemplate) rephrasePromptTemplateInput.value = defaultRephraseTemplate;
            rephrasePromptTemplateInput.disabled = submitQueryBtn.disabled;

            if (defaultFinalRagTemplate) finalRagPromptTemplateInput.value = defaultFinalRagTemplate;
            finalRagPromptTemplateInput.disabled = submitQueryBtn.disabled;
        }
    }

    // --- Event listeners for chat engine selection ---+
    function handleChatEngineChange() {
        const qwenModelId = 'onnx-community/Qwen3-0.6B-ONNX';
        const qwenOnnxPath = 'onnx/model_q4.onnx';
        const pleiasModelId = 'onnx-community/Pleias-RAG-350M-ONNX';
        const pleiasOnnxPath = 'onnx/model_quantized.onnx'; // Correct path

        if (chatEngineWebLLMRadio?.checked) {
            transformersModelInputDiv.style.display = 'none';
            transformersModelInput.disabled = true;
            transformersOnnxFileInput.disabled = true;
            updatePromptTemplates(false); // Restore default prompts
            updateGenerationSettingsUI(false); // Restore default generation settings
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = submitQueryBtn.disabled; // Enable based on overall readiness
        } else if (chatEnginePleiasRAGRadio?.checked) {
            transformersModelInputDiv.style.display = 'block';
            transformersModelInput.value = pleiasModelId;
            transformersOnnxFileInput.value = pleiasOnnxPath;
            transformersModelInput.disabled = true; // Disable editing for preset
            transformersOnnxFileInput.disabled = true; // Disable editing for preset
            updatePromptTemplates(true); // Set Pleias prompts
            updateGenerationSettingsUI(true); // Set Pleias generation settings
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = submitQueryBtn.disabled; // Re-enable rephrase button for Pleias
        } else if (chatEngineTransformersJSDefaultRadio?.checked) {
            transformersModelInputDiv.style.display = 'block';
            // Set back to default Qwen3, but allow editing
            if (transformersModelInput.value !== qwenModelId && transformersModelInput.value !== pleiasModelId) {
                // Only reset if it wasn't just switched from Pleias or doesn't already have Qwen
            } else {
                transformersModelInput.value = qwenModelId;
                transformersOnnxFileInput.value = qwenOnnxPath;
            }
            transformersModelInput.disabled = submitQueryBtn.disabled; // Enable if system is ready
            transformersOnnxFileInput.disabled = submitQueryBtn.disabled; // Enable if system is ready
            updatePromptTemplates(false); // Restore default prompts
            updateGenerationSettingsUI(false); // Restore default generation settings
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = submitQueryBtn.disabled; // Enable based on overall readiness
        } else {
            // Default case or error, hide the div
            transformersModelInputDiv.style.display = 'none';
            transformersModelInput.disabled = true;
            transformersOnnxFileInput.disabled = true;
            updatePromptTemplates(false); // Restore default prompts (safety)
            updateGenerationSettingsUI(false); // Restore default generation settings (safety)
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = true; // Disable rephrase button (safety)
        }
    }

    if (chatEngineWebLLMRadio && chatEngineTransformersJSDefaultRadio && chatEnginePleiasRAGRadio && transformersModelInputDiv && transformersModelInput && transformersOnnxFileInput) {
        chatEngineWebLLMRadio.addEventListener('change', handleChatEngineChange);
        chatEngineTransformersJSDefaultRadio.addEventListener('change', handleChatEngineChange);
        chatEnginePleiasRAGRadio.addEventListener('change', handleChatEngineChange);

        // Set initial state based on default checked radio button
        handleChatEngineChange();
    }

    // Set default prompt template values
    if (rephrasePromptTemplateInput) {
        rephrasePromptTemplateInput.value = `<|im_start|>system
**Objective:** Transform the User Query into a concise, factual query that will have high semantic similarity with records in our school database when used for RAG retrieval (vector cosine similarity).

** Our Database Records Typically Contain:**
    * Specific School Names and unique ID codes(e.g., 'Berkeley Special Education Preschool (01611430122804)')
    * School Type(e.g., 'Special Education School')
    * Full Street Addresses(e.g., '2020 Bonar St.')
    * City and State(e.g., 'Berkeley, California')
    * Specific District Names and unique ID codes(e.g., 'Berkeley Unified district (01611430000000)')
    * Grades Served(e.g., 'Preschool to P')
    * Website URLs(e.g., 'www.berkeley.net')

** Instructions for Rephrasing the User Query:**
1.  Identify the essential subject and details in the User Query.
2.  Rewrite the query to be a compact phrase or series of keywords.
3.  This rewritten query ** must predominantly feature and prioritize ** the types of specific information listed above(school / district names, locations, IDs, grades, etc.) if they are mentioned or clearly implied in the User Query.
4.  Eliminate all conversational filler, questions, polite phrases, and redundant words.The rephrased query should be dense with relevant factual terms.
5.  The final output should be optimized for accurate vector embedding comparison against our database records.

** Output Mandate:**
Return *only* the rephrased, optimized query. Do not include any explanations, labels, or introductory text.<|im_end|>
<|im_start|>user
{query}<|im_end|>
<|im_start|>assistant
`;
        defaultRephraseTemplate = rephrasePromptTemplateInput.value; // Store the default
    }
    if (finalRagPromptTemplateInput) {
        // The worker will handle inserting the system prompt if provided,
        // and format the context + query correctly into the user message.
        finalRagPromptTemplateInput.value = `<|im_start|>system
{system_prompt}<|im_end|>
<|im_start|>user
Context:
{context}

Based on the context, answer the following question:
{query}<|im_end|>
<|im_end|>
<|im_start|>assistant
`;
        defaultFinalRagTemplate = finalRagPromptTemplateInput.value; // Store the default
    }

    // Store initial default generation settings from the UI (after they are set by HTML and slider listeners)
    defaultAnswerSettings = {
        temperature: answerTemperatureSlider.value,
        top_p: answerTopPSlider.value,
        top_k: answerTopKInput.value,
        max_new_tokens: answerMaxNewTokensInput.value
    };
    defaultRephraseSettings = {
        temperature: rephraseTemperatureSlider.value,
        top_p: rephraseTopPSlider.value,
        top_k: rephraseTopKInput.value,
        max_new_tokens: rephraseMaxNewTokensInput.value
    };

    function updateStatus(message: string, isError: boolean = false, isReady?: boolean) {
        statusLabel.textContent = message;
        statusLabel.style.color = isError ? 'red' : '#555';
        if (isReady !== undefined) {
            submitQueryBtn.disabled = !isReady;
            queryInput.disabled = !isReady;
            if (systemPromptInput) systemPromptInput.disabled = !isReady;
            if (rephrasePromptTemplateInput) rephrasePromptTemplateInput.disabled = !isReady;
            if (finalRagPromptTemplateInput) finalRagPromptTemplateInput.disabled = !isReady;
            // Also manage step buttons
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = !isReady;
            if (retrieveContextBtn) retrieveContextBtn.disabled = true;
            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;

            // New chat engine UI elements
            if (chatEngineWebLLMRadio) chatEngineWebLLMRadio.disabled = !isReady;
            if (chatEnginePleiasRAGRadio) chatEnginePleiasRAGRadio.disabled = !isReady;
            if (chatEngineTransformersJSDefaultRadio) chatEngineTransformersJSDefaultRadio.disabled = !isReady;
            if (transformersModelInput) {
                transformersModelInput.disabled = !isReady || !chatEngineTransformersJSDefaultRadio.checked;
            }

            if (isReady) progressBarContainer.style.display = 'none';
        }
    }

    function updateProgress(message: string, loaded: number, total: number) {
        if (loaded < total) {
            progressBarContainer.style.display = 'block';
        }
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        progressBar.style.width = `${percent}%`;
        progressBar.textContent = `${percent}%`;
        statusLabel.textContent = message; // Also update status label with progress message
    }

    async function initializeInBrowserTransformers() {
        if (inBrowserExtractor) return true;
        if (similarityResultsArea) similarityResultsArea.innerHTML += '<p>Initializing in-browser Transformers.js model...</p>';
        try {
            CjsEnv.allowLocalModels = false;
            CjsEnv.useBrowserCache = true;
            // For feature-extraction, model name is usually sufficient.
            // Explicitly using Snowflake model ID from your validation script
            inBrowserExtractor = await pipeline('feature-extraction', 'Snowflake/snowflake-arctic-embed-xs', {
                device: "webgpu",
                progress_callback: (progress: any) => {
                    if (similarityResultsArea && progress.status === 'progress') {
                        similarityResultsArea.innerHTML += `<p style="font-size:0.8em; color:grey;">Loading model file: ${progress.file} (${Math.round(progress.loaded / progress.total * 100)}%)</p>`;
                    }
                }
            });
            if (similarityResultsArea) similarityResultsArea.innerHTML += '<p style="color:green;">In-browser Transformers.js model ready.</p>';
            return true;
        } catch (error) {
            console.error("RAG Test Main: Error initializing in-browser transformers.js pipeline:", error);
            if (similarityResultsArea) similarityResultsArea.innerHTML += `<p style="color:red;">Error initializing in-browser model: ${error instanceof Error ? error.message : String(error)}</p>`;
            return false;
        }
    }

    function initializeWorker() {
        // Access via casting instead of augmenting global scope
        const existingWorker = (window as any).ragWorker;
        if (existingWorker) {
            console.log("RAG Test Main: Worker already exists. Terminating old one.");
            existingWorker.terminate();
            (window as any).ragWorker = undefined;
        }

        console.log("RAG Test Main: Creating Web Worker using imported constructor...");
        try {
            // Instantiate the worker from the import
            worker = new RagWorker();
            console.log("RAG Test Main: Web Worker created.");

            worker.onmessage = (event: MessageEvent) => {
                // console.log("RAG Test Main: Message received from worker:", event.data);
                const { type, payload } = event.data;
                console.log(`RAG Test Main: Received message type: ${type}`, payload); // Log incoming payload

                switch (type) {
                    case 'status':
                        updateStatus(payload.message, payload.isError, payload.isReady);
                        if (payload.metrics) {
                            console.log("Performance Metrics:", payload.metrics);
                            // Optionally display these somewhere more permanent if needed
                        }
                        break;
                    case 'progress':
                        updateProgress(payload.message, payload.loaded, payload.total);
                        break;
                    case 'response': // Full RAG pipeline response
                        let responseHtml = '';
                        console.log("RAG Test Main: Handling 'response' message. Metrics:", payload?.metrics); // Log metrics specifically
                        if (payload.error) {
                            responseHtml = `<span style="color:red;">Error: ${escapeHtml(payload.error)}</span>`;
                        } else {
                            // Escape and highlight <think> blocks
                            responseHtml = highlightThinkBlocks(escapeHtml(payload.result || 'No result text.'));
                        }
                        // Add metrics if available
                        if (payload.metrics) {
                            responseHtml += `<br><small style="color:grey;">`;
                            responseHtml += `(Rephrase: ${payload.metrics.rephraseDuration?.toFixed(0)}ms | `;
                            responseHtml += `Context: ${payload.metrics.contextDuration?.toFixed(0)}ms | `;
                            responseHtml += `Generation: ${payload.metrics.finalAnswerDuration?.toFixed(0)}ms | `;
                            responseHtml += `Total: ${payload.metrics.totalPipelineDuration?.toFixed(0)}ms)</small>`;
                        }
                        responseArea.innerHTML = responseHtml;
                        console.log("RAG Test Main: Updated responseArea innerHTML:", responseArea.innerHTML.substring(0, 500) + "..."); // Log the final HTML
                        // Re-enable button after response, handled by status message typically
                        break;
                    case 'SIMILARITY_RESULT': // Handle result from worker
                        const { sampleId, webLLMSimilarity, error: webLLMError } = payload;
                        const resultRow = document.getElementById(`sample-row-${sampleId}`);
                        if (resultRow) {
                            const webLLMCell = resultRow.querySelector('.webllm-score');
                            if (webLLMCell) {
                                webLLMCell.textContent = webLLMError ? `Error: ${webLLMError}` : (webLLMSimilarity !== null ? webLLMSimilarity.toFixed(6) : 'N/A');
                                webLLMCell.parentElement!.style.color = webLLMError ? 'red' : 'inherit';
                            }
                        }
                        break;
                    case 'error': // General worker error not tied to a specific operation status
                        updateStatus(`Worker Error: ${payload.message}`, true, submitQueryBtn.disabled); // Keep current button state
                        console.error("RAG Test Main: Received error from worker:", payload.message);
                        break;
                    case 'REPHRASED_QUERY_RESULT':
                        console.log("Main: Received REPHRASED_QUERY_RESULT:", payload);
                        const { rephrasedQuery, error, metrics } = payload;

                        if (error) {
                            console.error("Main: Error during rephrasing:", error);
                            rephrasedQueryArea.innerHTML = `<span style="color:red;">Error: ${escapeHtml(error)}</span>`;
                            updateStatus(`Error rephrasing query: ${error}`, true, true);
                            // Allow retry for rephrase, but keep context/answer disabled
                            if (rephraseQueryBtn) rephraseQueryBtn.disabled = false;
                            if (retrieveContextBtn) retrieveContextBtn.disabled = true;
                            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
                        } else {
                            currentRephrasedQuery = rephrasedQuery;
                            let rephraseHtml = currentRephrasedQuery ? highlightThinkBlocks(escapeHtml(currentRephrasedQuery)) : 'No rephrased query returned.';
                            const duration = metrics?.duration ? (metrics.duration / 1000).toFixed(2) : 'N/A';
                            if (metrics) {
                                rephraseHtml += `<br><small style="color:grey;">(Duration: ${duration}s)</small>`;
                            }
                            rephrasedQueryArea.innerHTML = rephraseHtml;
                            updateStatus(`Standalone rephrase complete (${duration}s). Ready for context retrieval.`, false, true);

                            // Clear subsequent steps' outputs
                            currentRetrievedContext = null;
                            retrievedContextArea.textContent = "";
                            responseArea.textContent = "";

                            // Re-enable buttons for next steps
                            if (rephraseQueryBtn) rephraseQueryBtn.disabled = false;
                            if (retrieveContextBtn) retrieveContextBtn.disabled = !currentRephrasedQuery; // Enable if rephrase succeeded
                            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true; // Keep final answer disabled until context is retrieved
                        }
                        // Re-enable the run full pipeline button regardless of standalone success/failure
                        if (runSimilarityTestBtn) runSimilarityTestBtn.disabled = false; // Assuming this is the full pipeline button based on previous context?
                        // If not, replace with the correct button variable name.
                        break;
                    case 'RETRIEVED_CONTEXT_RESULT':
                        const { searchResults, error: contextError, metrics: contextMetrics } = payload;
                        console.log("RAG Test Main: Handling 'RETRIEVED_CONTEXT_RESULT'. Metrics:", contextMetrics, "Results:", searchResults);

                        let contextHtml = '';
                        currentRetrievedContext = null; // Reset context

                        if (contextError) {
                            contextHtml = `<span style="color:red;">Error: ${escapeHtml(contextError)}</span>`;
                            updateStatus(`Error retrieving context: ${contextError}`, true, true);
                            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
                        } else if (!searchResults || searchResults.length === 0) {
                            contextHtml = 'No relevant documents found.';
                            updateStatus('Context retrieval complete (no documents found). Ready for final answer generation (without context).', false, true);
                            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = false; // Allow generation without context
                        } else {
                            const minScore = parseFloat(minContextScoreSlider.value);
                            const filteredResults = searchResults.filter((result: { score: number }) => result.score >= minScore);

                            if (filteredResults.length === 0) {
                                contextHtml = `No documents met the minimum score threshold of ${minScore}. (Found ${searchResults.length} documents before filtering).`;
                                updateStatus(`Context retrieved, but no documents met score threshold (${minScore}). Ready for final answer generation (without context).`, false, true);
                                if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = false; // Allow generation without context
                            } else {
                                contextHtml = filteredResults.map((result: { text: string; score: number }) => {
                                    return `<div style="margin-bottom: 5px; border-bottom: 1px dashed #ccc; padding-bottom: 5px;">
                                                <strong style="color: #007bff;">(Score: ${result.score.toFixed(4)})</strong><br>
                                                ${escapeHtml(result.text)}
                                            </div>`;
                                }).join('');

                                // Store the TEXT content of the FILTERED results for the final answer step
                                currentRetrievedContext = filteredResults.map((r: { text: string }) => r.text).join('\n\n---\n\n');

                                updateStatus(`Context retrieved (${filteredResults.length}/${searchResults.length} documents passed score threshold ${minScore}). Ready for final answer generation.`, false, true);
                                if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = false; // Enable final answer generation
                            }
                        }

                        if (contextMetrics) {
                            contextHtml += `<br><small style="color:grey;">(Duration: ${(contextMetrics.duration / 1000).toFixed(2)}s)</small>`;
                        }
                        retrievedContextArea.innerHTML = contextHtml;
                        break;
                    case 'FINAL_ANSWER_RESULT':
                        if (payload) {
                            console.log("RAG Test Main: Handling 'FINAL_ANSWER_RESULT'. Metrics:", payload?.metrics); // Log metrics
                            let finalAnswerHtml = '';
                            if (payload.error) {
                                finalAnswerHtml = `<span style="color:red;">Error: ${escapeHtml(payload.error)}</span>`;
                            } else {
                                finalAnswerHtml = payload.finalAnswer ? highlightThinkBlocks(escapeHtml(payload.finalAnswer)) : 'No final answer text.';
                            }
                            if (payload.metrics) {
                                finalAnswerHtml += `<br><small style="color:grey;">(Duration: ${payload.metrics.duration?.toFixed(0)}ms)</small>`;
                            }
                            console.log("RAG Test Main: Generated finalAnswerHtml:", finalAnswerHtml.substring(0, 500) + "..."); // Log generated HTML
                            responseArea.innerHTML = finalAnswerHtml;
                            updateStatus(payload.error ? `Error generating final answer: ${payload.error}` : 'Final answer generated. Ready for new query/steps.', !!payload.error, true);
                        }
                        break;
                    default:
                        console.warn("RAG Test Main: Unknown message type from worker:", type);
                }
            };

            worker.onerror = (error: ErrorEvent) => {
                console.error("RAG Test Main: Error in RAG worker:", error);
                updateStatus(`Worker error: ${error.message}`, true, false);
                progressBarContainer.style.display = 'none';
            };

            // Send initialization message to worker
            console.log("RAG Test Main: Sending initialize message to worker...");
            worker.postMessage({ type: 'initialize' });
        } catch (error) {
            console.error("RAG Test Main: Error creating Web Worker:", error);
            updateStatus(`Worker error: ${error instanceof Error ? error.message : String(error)}`, true, false);
            progressBarContainer.style.display = 'none';
        }
    }

    submitQueryBtn.addEventListener('click', () => {
        const query = queryInput.value.trim();
        const systemPrompt = systemPromptInput.value.trim();
        const rephraseTemplate = rephrasePromptTemplateInput.value.trim();
        const finalRagTemplate = finalRagPromptTemplateInput.value.trim();

        // Get chat engine config
        const chatEngineType = chatEnginePleiasRAGRadio.checked ? 'transformers_pleias' :
            (chatEngineTransformersJSDefaultRadio.checked ? 'transformers' : 'webllm');
        const transformersModelId = transformersModelInput.value.trim();

        // Gather rephrase and answer settings
        const rephraseSettings = {
            temperature: parseFloat(rephraseTemperatureSlider.value),
            top_p: parseFloat(rephraseTopPSlider.value),
            top_k: parseInt(rephraseTopKInput.value, 10),
            max_new_tokens: parseInt(rephraseMaxNewTokensInput.value, 10)
        };
        const answerSettings = {
            temperature: parseFloat(answerTemperatureSlider.value),
            top_p: parseFloat(answerTopPSlider.value),
            top_k: parseInt(answerTopKInput.value, 10),
            max_new_tokens: parseInt(answerMaxNewTokensInput.value, 10)
        };

        if (!query) {
            alert("Please enter a query.");
            return;
        }
        if (!rephraseTemplate.includes('{query}')) {
            alert("Rephrase prompt template must include '{query}' placeholder.");
            return;
        }
        if (!finalRagTemplate.includes('{context}') || !finalRagTemplate.includes('{query}')) {
            alert("Final RAG prompt template must include '{context}' and '{query}' placeholders.");
            return;
        }
        if (chatEngineType === 'transformers' && !transformersModelId) {
            alert("Please enter a Transformers.js model ID or URL.");
            return;
        }

        if (worker) {
            responseArea.textContent = 'Processing...';
            responseArea.style.color = '#555';
            updateStatus('Sending query to RAG system (full pipeline)...', false, false);
            // Disable step buttons during full pipeline execution
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = true;
            if (retrieveContextBtn) retrieveContextBtn.disabled = true;
            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
            rephrasedQueryArea.textContent = "";
            retrievedContextArea.textContent = "";
            currentOriginalQuery = query; // Store for potential use in step-by-step if needed after full run

            worker.postMessage({
                type: 'query',
                payload: {
                    query,
                    systemPrompt: systemPrompt || null,
                    rephrasePromptTemplate: rephraseTemplate,
                    finalRagPromptTemplate: finalRagTemplate,
                    chatEngineType, // Pass chat engine type
                    transformersModelId: chatEngineType === 'transformers' ? transformersModelId : null, // Pass model ID if transformers
                    transformersOnnxFile: chatEngineType === 'transformers' ? transformersOnnxFileInput.value.trim() : null, // Pass ONNX file path/url
                    rephraseSettings,
                    answerSettings
                }
            });
        }
    });

    if (runSimilarityTestBtn) {
        runSimilarityTestBtn.addEventListener('click', async () => {
            if (!similarityValidationSamples.length) {
                similarityResultsArea.innerHTML = '<p style="color:orange;">No similarity samples loaded to test.</p>';
                return;
            }
            runSimilarityTestBtn.disabled = true;
            similarityResultsArea.innerHTML = '<p>Running similarity tests...</p>';

            const inBrowserReady = await initializeInBrowserTransformers();

            let tableHtml = `
                <table> 
                    <thead>
                        <tr>
                            <th>Sample ID</th>
                            <th>Text 1 (Preview)</th>
                            <th>Text 2 (Preview)</th>
                            <th>Pre-computed (Node Transformers.js)</th>
                            <th>WebLLM (MLC)</th>
                            <th>In-Browser Transformers.js</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            for (const sample of similarityValidationSamples) {
                tableHtml += `<tr id="sample-row-${sample.id}">
                                <td>${sample.id}</td>
                                <td>${sample.text1.substring(0, 30)}...</td>
                                <td>${sample.text2.substring(0, 30)}...</td>
                                <td>${sample.transformersJsSimilarity !== null ? sample.transformersJsSimilarity.toFixed(6) : 'N/A'}</td>
                                <td class="webllm-score">Pending...</td>
                                <td class="inbrowser-transformers-score">Pending...</td>
                            </tr>`;

                // 1. Request WebLLM similarity from worker
                if (worker) {
                    worker.postMessage({
                        type: 'GET_EMBEDDING_SIMILARITY',
                        payload: {
                            sampleId: sample.id,
                            text1: sample.text1,
                            text2: sample.text2
                        }
                    });
                }
            }
            tableHtml += '</tbody></table>';
            similarityResultsArea.innerHTML = tableHtml;

            // 2. Calculate In-Browser Transformers.js similarity (after table is rendered)
            if (inBrowserReady && inBrowserExtractor) {
                for (const sample of similarityValidationSamples) {
                    const resultRow = document.getElementById(`sample-row-${sample.id}`);
                    const inBrowserCell = resultRow?.querySelector('.inbrowser-transformers-score');
                    if (!inBrowserCell) continue;

                    try {
                        const output1 = await inBrowserExtractor(sample.text1, { pooling: 'cls', normalize: true });
                        const emb1 = normalizeL2(output1.data as Float32Array); // Ensure normalization, though pipeline should do it

                        const output2 = await inBrowserExtractor(sample.text2, { pooling: 'cls', normalize: true });
                        const emb2 = normalizeL2(output2.data as Float32Array);

                        if (emb1.length !== 384 || emb2.length !== 384) { // Assuming EXPECTED_EMBEDDING_DIMENSIONS is 384
                            throw new Error(`Dimension mismatch: ${emb1.length}, ${emb2.length}`);
                        }
                        const similarity = calculateCosineSimilarity(emb1, emb2);
                        inBrowserCell.textContent = similarity.toFixed(6);
                    } catch (e) {
                        console.error(`Error with in-browser transformers for sample ${sample.id}:`, e);
                        inBrowserCell.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
                        if (resultRow) resultRow.style.color = 'red';
                    }
                }
            }
            runSimilarityTestBtn.disabled = false;
        });
    }

    // Event Listeners for step-by-step RAG
    if (rephraseQueryBtn) {
        rephraseQueryBtn.addEventListener('click', () => {
            const originalQuery = queryInput.value.trim();
            const rephraseTemplate = rephrasePromptTemplateInput.value.trim();
            const systemPrompt = systemPromptInput.value.trim(); // System prompt might influence rephrasing

            // Get chat engine config
            const chatEngineType = chatEnginePleiasRAGRadio.checked ? 'transformers_pleias' :
                (chatEngineTransformersJSDefaultRadio.checked ? 'transformers' : 'webllm');
            const transformersModelId = transformersModelInput.value.trim();

            if (!originalQuery) {
                alert("Please enter an original query.");
                return;
            }
            if (!rephraseTemplate.includes('{query}')) {
                alert("Rephrase prompt template must include '{query}' placeholder.");
                return;
            }
            if (chatEngineType === 'transformers' && !transformersModelId) {
                alert("Please enter a Transformers.js model ID or URL for rephrasing.");
                return;
            }

            if (worker) {
                currentOriginalQuery = originalQuery; // Store original query
                updateStatus('Rephrasing query...', false, false);
                if (retrieveContextBtn) retrieveContextBtn.disabled = true;
                if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
                rephrasedQueryArea.textContent = 'Rephrasing...';
                retrievedContextArea.textContent = ''; // Clear old context

                // Gather rephrase model settings from UI
                const rephraseSettings = {
                    temperature: parseFloat(rephraseTemperatureSlider.value),
                    top_p: parseFloat(rephraseTopPSlider.value),
                    top_k: parseInt(rephraseTopKInput.value, 10),
                    max_new_tokens: parseInt(rephraseMaxNewTokensInput.value, 10)
                };

                worker.postMessage({
                    type: 'REPHRASE_QUERY',
                    payload: {
                        originalQuery,
                        rephrasePromptTemplate: rephraseTemplate,
                        systemPrompt: systemPrompt || null,
                        chatEngineType,
                        transformersModelId: chatEngineType === 'transformers' ? transformersModelId : null,
                        transformersOnnxFile: chatEngineType === 'transformers' ? transformersOnnxFileInput.value.trim() : null,
                        rephraseSettings // Pass all rephrase model settings
                    }
                });
            }
        });
    }

    if (retrieveContextBtn) {
        retrieveContextBtn.addEventListener('click', () => {
            const queryForContext = currentRephrasedQuery || currentOriginalQuery; // Use rephrased, fallback to original

            if (!queryForContext) {
                alert("No query available (original or rephrased) to retrieve context.");
                return;
            }
            if (worker) {
                updateStatus('Retrieving context...', false, false);
                if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
                retrievedContextArea.textContent = 'Retrieving...';

                worker.postMessage({
                    type: 'RETRIEVE_CONTEXT',
                    payload: {
                        queryForContext
                        // Potentially add other search parameters here if needed later
                    }
                });
            }
        });
    }

    if (generateFinalAnswerBtn) {
        generateFinalAnswerBtn.addEventListener('click', () => {
            const finalQuery = currentOriginalQuery; // Use the original query for the final question
            const context = currentRetrievedContext;
            const finalRagTemplate = finalRagPromptTemplateInput.value.trim();
            const systemPrompt = systemPromptInput.value.trim();

            // Get chat engine config
            const chatEngineType = chatEnginePleiasRAGRadio.checked ? 'transformers_pleias' :
                (chatEngineTransformersJSDefaultRadio.checked ? 'transformers' : 'webllm');
            const transformersModelId = transformersModelInput.value.trim();

            if (!finalQuery) {
                alert("Original query is missing for final answer generation.");
                return;
            }
            if (!context) {
                alert("Retrieved context is missing for final answer generation.");
                return;
            }
            if (!finalRagTemplate.includes('{context}') || !finalRagTemplate.includes('{query}')) {
                alert("Final RAG prompt template must include '{context}' and '{query}' placeholders.");
                return;
            }
            if (chatEngineType === 'transformers' && !transformersModelId) {
                alert("Please enter a Transformers.js model ID or URL for final answer generation.");
                return;
            }

            if (worker) {
                responseArea.textContent = 'Generating final answer...';
                responseArea.style.color = '#555';
                updateStatus('Generating final answer...', false, false);

                // Gather answer model settings from UI
                const answerSettings = {
                    temperature: parseFloat(answerTemperatureSlider.value),
                    top_p: parseFloat(answerTopPSlider.value),
                    top_k: parseInt(answerTopKInput.value, 10),
                    max_new_tokens: parseInt(answerMaxNewTokensInput.value, 10)
                };

                worker.postMessage({
                    type: 'GENERATE_FINAL_ANSWER',
                    payload: {
                        originalQuery: finalQuery, // Use the original query for the final Q
                        context: context,
                        systemPrompt: systemPrompt || null,
                        finalRagPromptTemplate: finalRagTemplate,
                        chatEngineType,
                        transformersModelId: chatEngineType.startsWith('transformers') ? transformersModelId : null,
                        transformersOnnxFile: chatEngineType.startsWith('transformers') ? transformersOnnxFileInput.value.trim() : null,
                        answerSettings // Pass all answer model settings
                    }
                });
            }
        });
    }

    // Clean up worker when page is about to be unloaded
    window.addEventListener('beforeunload', () => {
        if ((window as any).ragWorker) {
            console.log("RAG Test Main: Page unloading. Requesting worker to dispose engines.");
            (window as any).ragWorker.postMessage({ type: 'dispose' });
        }
    });

    // Initialize the worker after setting up listeners
    initializeWorker();
}); 