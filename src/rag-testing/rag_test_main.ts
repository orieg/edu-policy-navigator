console.log("RAG Test Main: Script loaded.");

// Import the worker using Vite's ?worker syntax
import RagWorker from '/src/rag-testing/rag_worker.ts?worker';
// Dynamically import transformers.js for in-browser use
import { pipeline, env as CjsEnv } from '@huggingface/transformers';
import type { SearchResult } from '../types/vectorStore';

interface SimilaritySampleData {
    id: string;
    text1: string;
    text2: string;
    embedding1?: number[];
    embedding2?: number[];
    transformersJsSimilarity: number | null; // Pre-computed from Node.js
}

let similarityValidationSamples: SimilaritySampleData[] = [];
let systemPromptContainer: HTMLDivElement | null = null; // Declare here, outside listener

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
    const retrieveContextOriginalBtn = document.getElementById('retrieveContextOriginalBtn') as HTMLButtonElement;

    // New context score slider UI
    const minContextScoreSlider = document.getElementById('minContextScoreSlider') as HTMLInputElement;
    const minContextScoreValue = document.getElementById('minContextScoreValue') as HTMLSpanElement;

    // New Search All Documents Checkbox
    const searchAllDocumentsCheckbox = document.getElementById('searchAllDocumentsCheckbox') as HTMLInputElement;

    // New Similarity Metric Select
    const similarityMetricSelect = document.getElementById('similarityMetricSelect') as HTMLSelectElement;

    // Chat model config UI
    const chatEngineWebLLMRadio = document.getElementById('chatEngineWebLLM') as HTMLInputElement;
    const chatEngineTransformersJSDefaultRadio = document.getElementById('chatEngineTransformersJSDefault') as HTMLInputElement;
    const chatEnginePleiasRAGRadio = document.getElementById('chatEnginePleiasRAG') as HTMLInputElement;
    const chatEnginePleiasRAG1BRadio = document.getElementById('chatEnginePleiasRAG1B') as HTMLInputElement;
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

    // New MLC Model Select UI
    const mlcModelSelectDiv = document.getElementById('mlcModelSelectDiv') as HTMLDivElement;
    const mlcModelSelect = document.getElementById('mlcModelSelect') as HTMLSelectElement;

    // --- Elements for Hybrid Search PoC ---
    const searchModeSelect = document.getElementById('searchModeSelect') as HTMLSelectElement;
    const bm25ParamsDiv = document.getElementById('bm25ParamsDiv') as HTMLDivElement;
    const bm25K1Input = document.getElementById('bm25K1Input') as HTMLInputElement;
    const bm25BInput = document.getElementById('bm25BInput') as HTMLInputElement;
    const rrfParamsDiv = document.getElementById('rrfParamsDiv') as HTMLDivElement;
    const rrfKInput = document.getElementById('rrfKInput') as HTMLInputElement;
    const hybridTopNInput = document.getElementById('hybridTopNInput') as HTMLInputElement; // Or a shared topN
    const bm25ResultsArea = document.getElementById('bm25ResultsArea') as HTMLDivElement;
    const hybridSearchResultsArea = document.getElementById('hybridSearchResultsArea') as HTMLDivElement;
    // --- End Elements for Hybrid Search PoC ---

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
        chatEnginePleiasRAG1BRadio,
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
        minContextScoreValue,
        retrieveContextOriginalBtn,
        mlcModelSelectDiv,
        mlcModelSelect,
        searchAllDocumentsCheckbox,
        similarityMetricSelect,
        searchModeSelect,
        bm25ParamsDiv,
        bm25K1Input,
        bm25BInput,
        rrfParamsDiv,
        rrfKInput,
        hybridTopNInput,
        bm25ResultsArea,
        hybridSearchResultsArea,
    };
    systemPromptContainer = document.getElementById('systemPromptContainerDiv') as HTMLDivElement; // Assign inside listener
    const validationSimilarityMetricSelect = document.getElementById('validationSimilarityMetricSelect') as HTMLSelectElement;

    for (const [name, element] of Object.entries(requiredElements)) {
        if (!element) {
            throw new Error(`Initialization Error: Failed to find required DOM element with ID corresponding to variable '${name}'. Check HTML structure and IDs.`);
        }
    }
    // Keep the check here
    if (!systemPromptContainer) {
        throw new Error(`Initialization Error: Failed to find required DOM element with ID 'systemPromptContainerDiv'. Check HTML structure and IDs.`);
    }

    let worker: Worker | undefined;
    let isWorkerReady: boolean = false; // Declare isWorkerReady here
    let inBrowserExtractor: any = null; // For in-browser transformers.js pipeline

    // Intermediate state for step-by-step RAG
    let currentRephrasedQuery: string | null = null;
    let currentRetrievedContext: string | null = null;
    let currentOriginalQuery: string | null = null;
    let currentRetrievedSearchResults: SearchResult[] | null = null; // Add variable for the actual results array

    // Store default prompt template values
    let defaultRephraseTemplate = '';
    let defaultFinalRagTemplate = '';

    // --- Define MLC Model Specific Prompt Configurations ---
    interface PromptConfig {
        rephrase: string;
        finalRag: string;
        showSystemPromptInput: boolean;
    }

    const mlcModelPromptConfigs: Record<string, PromptConfig> = {
        'Llama-3.2-1B-Instruct-q4f32_1-MLC': {
            rephrase: `<|begin_of_text|><|start_header_id|>system<|end_header_id|>
You are a query rephrasing assistant. Transform the user query into a concise, factual query for database retrieval.
Focus on specific entities like school/district names, locations, IDs. Eliminate conversational filler.
Output ONLY the rephrased query.<|eot_id|><|start_header_id|>user<|end_header_id|>
{query}<|eot_id|><|start_header_id|>assistant<|end_header_id|>`,
            finalRag: `<|begin_of_text|><|start_header_id|>system<|end_header_id|>
{system_prompt}<|eot_id|><|start_header_id|>user<|end_header_id|>
Context:
{context}

Based on the context, answer the following question:
{query}<|eot_id|><|start_header_id|>assistant<|end_header_id|>`,
            showSystemPromptInput: true,
        },
        'Phi-3-mini-4k-instruct-q4f32_1-MLC': {
            rephrase: `<s><|user|>
Rephrase the following query for optimal database retrieval, focusing on factual keywords:
{query}<|end|>
<|assistant|>`,
            finalRag: `<s><|user|>
{system_prompt}
Based on the following context, please answer the query.
Context:
{context}
Query: {query}<|end|>
<|assistant|>`,
            showSystemPromptInput: true,
        },
        'gemma-2-2b-it-q4f32_1-MLC': {
            rephrase: `<start_of_turn>user
Rephrase for database retrieval: {query}<end_of_turn>
<start_of_turn>model`,
            finalRag: `<start_of_turn>user
{system_prompt}
Context:
{context}
Query: {query}<end_of_turn>
<start_of_turn>model`,
            showSystemPromptInput: true,
        },
        'TinyLlama-1.1B-Chat-v1.0-q4f32_1-MLC': {
            rephrase: `<|system|>
You are a query rephrasing assistant. Transform the user query into a concise, factual query for database retrieval.
Focus on specific entities like school/district names, locations, IDs. Eliminate conversational filler.
Output ONLY the rephrased query.</s>
<|user|>
{query}</s>
<|assistant|>`,
            finalRag: `<|begin_of_text|><|start_header_id|>system<|end_header_id|>
{system_prompt}<|eot_id|><|start_header_id|>user<|end_header_id|>
Context:
{context}

Based on the context, answer the following question:
{query}<|eot_id|><|start_header_id|>assistant<|end_header_id|>`,
            showSystemPromptInput: true,
        },
        // Add more model configs as needed
        'DEFAULT_WEBLLM': { // Fallback for WebLLM models not explicitly listed
            rephrase: defaultRephraseTemplate, // Will be set later
            finalRag: defaultFinalRagTemplate, // Will be set later
            showSystemPromptInput: true,
        }
    };

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
    function updatePromptTemplates(isPleias: boolean, mlcModelId?: string) {
        let currentConfig: PromptConfig | undefined = undefined;
        let showSystemPrompt = true;

        if (chatEngineWebLLMRadio?.checked && mlcModelId) {
            currentConfig = mlcModelPromptConfigs[mlcModelId] || mlcModelPromptConfigs['DEFAULT_WEBLLM'];
        } else if (isPleias) {
            currentConfig = {
                rephrase: `<|query_start|>{query}<|query_end|>\n<|source_analysis_start|>`,
                finalRag: `<|query_start|>{query}<|query_end|>\n{context}\n<|source_analysis_start|>`,
                showSystemPromptInput: false,
            };
        }

        if (currentConfig) {
            rephrasePromptTemplateInput.value = currentConfig.rephrase;
            finalRagPromptTemplateInput.value = currentConfig.finalRag;
            showSystemPrompt = currentConfig.showSystemPromptInput;
        } else {
            // Fallback to general defaults if no other config matched
            rephrasePromptTemplateInput.value = defaultRephraseTemplate;
            finalRagPromptTemplateInput.value = defaultFinalRagTemplate;
            showSystemPrompt = true; // Show system prompt by default for non-Pleias, non-specific MLC
        }

        rephrasePromptTemplateInput.disabled = false; // Ensure editable
        finalRagPromptTemplateInput.disabled = false; // Ensure editable

        if (systemPromptContainer) {
            systemPromptContainer.style.display = showSystemPrompt ? '' : 'none';
        }
    }

    // --- Event listeners for chat engine selection ---+
    function handleChatEngineChange() {
        const qwenModelId = 'onnx-community/Qwen3-0.6B-ONNX';
        const qwenOnnxPath = 'onnx/model_q4.onnx';
        const pleiasModelId = 'onnx-community/Pleias-RAG-350M-ONNX';
        const pleiasOnnxPath = 'onnx/model_quantized.onnx'; // Correct path
        const pleias1BModelId = 'onnx-community/Pleias-RAG-1B-ONNX'; // New 1B model ID
        const pleias1BOnnxPath = 'onnx/model_quantized.onnx'; // Assuming same quantized path for 1B

        if (chatEngineWebLLMRadio?.checked) {
            transformersModelInputDiv.style.display = 'none';
            transformersModelInput.disabled = true;
            transformersOnnxFileInput.disabled = true;
            mlcModelSelectDiv.style.display = 'block'; // Show MLC select
            mlcModelSelect.disabled = submitQueryBtn.disabled; // Enable/disable based on system readiness
            updatePromptTemplates(false, mlcModelSelect.value); // Pass selected MLC model
            updateGenerationSettingsUI(false); // Restore default generation settings
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = submitQueryBtn.disabled; // Enable based on overall readiness
        } else if (chatEnginePleiasRAG1BRadio?.checked) { // Add handling for 1B model
            transformersModelInputDiv.style.display = 'block';
            transformersModelInput.value = pleias1BModelId;
            transformersOnnxFileInput.value = pleias1BOnnxPath; // Use 1B path (assumed same for now)
            transformersModelInput.disabled = true; // Disable editing for preset
            transformersOnnxFileInput.disabled = true; // Disable editing for preset
            mlcModelSelectDiv.style.display = 'none'; // Hide MLC select
            mlcModelSelect.disabled = true;
            updatePromptTemplates(true); // Set Pleias prompts
            updateGenerationSettingsUI(true); // Set Pleias generation settings
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = submitQueryBtn.disabled; // Re-enable rephrase button for Pleias
        } else if (chatEnginePleiasRAGRadio?.checked) {
            transformersModelInputDiv.style.display = 'block';
            transformersModelInput.value = pleiasModelId;
            transformersOnnxFileInput.value = pleiasOnnxPath;
            transformersModelInput.disabled = true; // Disable editing for preset
            transformersOnnxFileInput.disabled = true; // Disable editing for preset
            mlcModelSelectDiv.style.display = 'none'; // Hide MLC select
            mlcModelSelect.disabled = true;
            updatePromptTemplates(true); // Set Pleias prompts
            updateGenerationSettingsUI(true); // Set Pleias generation settings
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = submitQueryBtn.disabled; // Re-enable rephrase button for Pleias
        } else if (chatEngineTransformersJSDefaultRadio?.checked) {
            transformersModelInputDiv.style.display = 'block';
            // Set back to default Qwen3, but allow editing
            if (transformersModelInput.value !== qwenModelId && transformersModelInput.value !== pleiasModelId && transformersModelInput.value !== pleias1BModelId) {
                // Only reset if it wasn't just switched from Pleias or doesn't already have Qwen
            } else {
                transformersModelInput.value = qwenModelId;
                transformersOnnxFileInput.value = qwenOnnxPath;
            }
            transformersModelInput.disabled = submitQueryBtn.disabled; // Enable if system is ready
            transformersOnnxFileInput.disabled = submitQueryBtn.disabled; // Enable if system is ready
            updatePromptTemplates(false); // Restore default prompts for non-MLC, non-Pleias
            updateGenerationSettingsUI(false); // Restore default generation settings
            mlcModelSelectDiv.style.display = 'none'; // Hide MLC select
            mlcModelSelect.disabled = true;
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

        if (chatEngineWebLLMRadio) chatEngineWebLLMRadio.disabled = !submitQueryBtn.disabled;
        if (chatEnginePleiasRAGRadio) chatEnginePleiasRAGRadio.disabled = !submitQueryBtn.disabled;
        if (chatEngineTransformersJSDefaultRadio) chatEngineTransformersJSDefaultRadio.disabled = !submitQueryBtn.disabled;
        if (chatEnginePleiasRAG1BRadio) chatEnginePleiasRAG1BRadio.disabled = !submitQueryBtn.disabled;
        if (mlcModelSelect) {
            const systemIsBusy = submitQueryBtn.disabled;
            const webLlmEngineSelected = chatEngineWebLLMRadio.checked;
            const shouldBeDisabled = systemIsBusy || !webLlmEngineSelected;
            console.log(`RAG Test Main (handleChatEngineChange): Setting mlcModelSelect.disabled = ${shouldBeDisabled} (systemIsBusy: ${systemIsBusy}, webLlmEngineSelected: ${webLlmEngineSelected})`);
            mlcModelSelect.disabled = shouldBeDisabled;
        }
        if (transformersModelInput) {
            transformersModelInput.disabled = !submitQueryBtn.disabled || !chatEngineTransformersJSDefaultRadio.checked;
        }
        if (transformersOnnxFileInput) {
            transformersOnnxFileInput.disabled = !submitQueryBtn.disabled || !chatEngineTransformersJSDefaultRadio.checked;
        }

        if (submitQueryBtn.disabled) {
            progressBarContainer.style.display = 'block';
        } else {
            progressBarContainer.style.display = 'none';
        }
    }

    if (chatEngineWebLLMRadio && chatEngineTransformersJSDefaultRadio && chatEnginePleiasRAGRadio && chatEnginePleiasRAG1BRadio && transformersModelInputDiv && transformersModelInput && transformersOnnxFileInput && mlcModelSelectDiv && mlcModelSelect) {
        chatEngineWebLLMRadio.addEventListener('change', handleChatEngineChange);
        chatEngineTransformersJSDefaultRadio.addEventListener('change', handleChatEngineChange);
        chatEnginePleiasRAGRadio.addEventListener('change', handleChatEngineChange);
        chatEnginePleiasRAG1BRadio.addEventListener('change', handleChatEngineChange);
        mlcModelSelect.addEventListener('change', () => {
            if (chatEngineWebLLMRadio.checked) { // Check if WebLLM is active
                // Update prompts first, before potentially slow worker re-initialization
                updatePromptTemplates(false, mlcModelSelect.value);

                if (!submitQueryBtn.disabled) { // Only re-init worker if system is ready
                    console.log("RAG Test Main: MLC Model selection changed. Re-initializing worker for WebLLM.");
                    updateStatus(`Initializing new WebLLM model: ${mlcModelSelect.value}...`, false, false);
                    if (progressBar && progressBarContainer) {
                        progressBar.style.width = `0%`;
                        progressBar.textContent = `0%`;
                        progressBarContainer.style.display = 'block';
                    }
                    initializeWorker();
                }
            }
        });

        // Set initial state based on default checked radio button
        handleChatEngineChange();
    }

    // Set default prompt template values
    if (rephrasePromptTemplateInput) {
        rephrasePromptTemplateInput.value = `<|im_start|>system
Convert User Query into a concise, affirmative list of essential keywords for database semantic search.
Focus on: School/District Names, IDs, Locations, Grades, Type.
Remove: Questions, greetings, filler.
Output only keywords<|im_end|>
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

    // After defaults are set, populate the DEFAULT_WEBLLM config
    mlcModelPromptConfigs['DEFAULT_WEBLLM'] = {
        rephrase: defaultRephraseTemplate,
        finalRag: defaultFinalRagTemplate,
        showSystemPromptInput: true,
    };

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
            isWorkerReady = isReady; // Update isWorkerReady here
            submitQueryBtn.disabled = !isReady;
            queryInput.disabled = !isReady;
            if (systemPromptInput) systemPromptInput.disabled = !isReady;
            if (rephrasePromptTemplateInput) rephrasePromptTemplateInput.disabled = !isReady;
            if (finalRagPromptTemplateInput) finalRagPromptTemplateInput.disabled = !isReady;
            // Also manage step buttons
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = !isReady;
            if (retrieveContextBtn) retrieveContextBtn.disabled = true;
            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
            if (retrieveContextOriginalBtn) retrieveContextOriginalBtn.disabled = !isReady || !queryInput.value.trim();

            // New chat engine UI elements
            if (chatEngineWebLLMRadio) chatEngineWebLLMRadio.disabled = !isReady;
            if (chatEnginePleiasRAGRadio) chatEnginePleiasRAGRadio.disabled = !isReady;
            if (chatEngineTransformersJSDefaultRadio) chatEngineTransformersJSDefaultRadio.disabled = !isReady;
            if (chatEnginePleiasRAG1BRadio) chatEnginePleiasRAG1BRadio.disabled = !isReady;
            if (mlcModelSelect) mlcModelSelect.disabled = !isReady || !chatEngineWebLLMRadio.checked;
            if (transformersModelInput) {
                transformersModelInput.disabled = !isReady || !chatEngineTransformersJSDefaultRadio.checked;
            }
            if (transformersOnnxFileInput) {
                transformersOnnxFileInput.disabled = !isReady || !chatEngineTransformersJSDefaultRadio.checked;
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
        // Terminate existing scoped worker instance if it exists
        if (worker) {
            console.log("RAG Test Main: Terminating existing worker instance before re-initializing.");
            worker.terminate();
            worker = undefined;
        }

        console.log("RAG Test Main: Creating Web Worker using imported constructor...");
        try {
            // Instantiate the worker from the import
            worker = new RagWorker();
            (window as any).ragWorker = worker; // Also assign to window for HMR listener for now
            console.log("RAG Test Main: Web Worker created.");

            worker.onmessage = (event: MessageEvent) => {
                // console.log("RAG Test Main: Message received from worker:", event.data);
                const { type, payload } = event.data;
                // console.debug(`RAG Test Main: Received message type: ${type}`, payload); // Log incoming payload

                switch (type) {
                    case 'status':
                        updateStatus(payload.message, payload.isError, payload.isReady);
                        if (payload.metrics) {
                            console.log("Performance Metrics:", payload.metrics);
                            // Optionally display these somewhere more permanent if needed
                        }
                        break;
                    case 'progress':
                        console.log("RAG Test Main: Received 'progress' message from worker:", payload);
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
                            const { rephraseDuration, contextDuration, finalAnswerDuration, totalPipelineDuration, generatedTokenCount } = payload.metrics;
                            responseHtml += `(Rephrase: ${rephraseDuration?.toFixed(0)}ms | `;
                            responseHtml += `Context: ${contextDuration?.toFixed(0)}ms | `;
                            responseHtml += `Generation: ${finalAnswerDuration?.toFixed(0)}ms`;
                            if (generatedTokenCount && finalAnswerDuration && finalAnswerDuration > 0) {
                                const tkPerS = (generatedTokenCount / (finalAnswerDuration / 1000)).toFixed(2);
                                responseHtml += ` (${generatedTokenCount} tk, ${tkPerS} tk/s)`;
                            }
                            responseHtml += ` | Total: ${totalPipelineDuration?.toFixed(0)}ms)</small>`;
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
                    case 'GENERATION_UPDATE': // Handle partial generation results
                        const { partialResult } = payload;
                        console.log("RAG Test Main: Received GENERATION_UPDATE", partialResult); // <<< ADD LOG HERE
                        if (typeof partialResult === 'string') {
                            // Display partial result, maybe clean prompt if needed, add indicator
                            // For now, just display raw partial output + indicator
                            // The final 'response' or 'FINAL_ANSWER_RESULT' will provide the fully cleaned text.
                            const partialHtml = highlightThinkBlocks(escapeHtml(partialResult)) + '<span style="color:grey;">...</span>';
                            responseArea.innerHTML = partialHtml;
                        }
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
                                rephraseHtml += `<br><small style="color:grey;">(Duration: ${duration}s`;
                                if (metrics.generatedTokenCount && metrics.duration && metrics.duration > 0) {
                                    const tkPerS = (metrics.generatedTokenCount / (metrics.duration / 1000)).toFixed(2);
                                    rephraseHtml += `, ${metrics.generatedTokenCount} tk, ${tkPerS} tk/s`;
                                }
                                rephraseHtml += `)</small>`;
                            }
                            rephrasedQueryArea.innerHTML = rephraseHtml;
                            updateStatus(`Standalone rephrase complete (${duration}s). Ready for context retrieval.`, false, true);

                            // Clear subsequent steps' outputs
                            currentRetrievedContext = null;
                            currentRetrievedSearchResults = null; // Clear results array too
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
                        currentRetrievedContext = null; // Reset context display string
                        currentRetrievedSearchResults = null; // Reset results array

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
                                // Store the actual FILTERED SearchResult objects
                                currentRetrievedSearchResults = filteredResults;

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
                                finalAnswerHtml += `<br><small style="color:grey;">(Duration: ${payload.metrics.duration?.toFixed(0)}ms`;
                                if (payload.metrics.generatedTokenCount && payload.metrics.duration && payload.metrics.duration > 0) {
                                    const tkPerS = (payload.metrics.generatedTokenCount / (payload.metrics.duration / 1000)).toFixed(2);
                                    finalAnswerHtml += `, ${payload.metrics.generatedTokenCount} tk, ${tkPerS} tk/s`;
                                }
                                finalAnswerHtml += `)</small>`;
                            }
                            console.log("RAG Test Main: Generated finalAnswerHtml:", finalAnswerHtml.substring(0, 500) + "..."); // Log generated HTML
                            responseArea.innerHTML = finalAnswerHtml;
                            updateStatus(payload.error ? `Error generating final answer: ${payload.error}` : 'Final answer generated. Ready for new query/steps.', !!payload.error, true);
                        }
                        break;
                    case 'SIMILARITY_TEST_RESULTS':
                        console.log("Received similarity test results from worker:", payload);
                        displaySimilarityResults(payload);
                        statusLabel.textContent = 'Similarity validation complete.';
                        if (runSimilarityTestBtn) runSimilarityTestBtn.disabled = false;
                        break;
                    case 'BM25_SEARCH_RESULTS':
                        isWorkerReady = true;
                        updateProgress('Done', 100, 100);
                        if (payload.error) {
                            bm25ResultsArea.innerHTML = `<div class="error">BM25 Error: ${escapeHtml(payload.error)}</div>`;
                        } else if (payload.results) {
                            displaySearchResults(payload.results, bm25ResultsArea, 'BM25 Results');
                        }
                        if (payload.metrics) {
                            displayMetrics(payload.metrics, bm25ResultsArea);
                        }
                        break;
                    case 'HYBRID_SEARCH_RESULTS':
                        isWorkerReady = true;
                        updateProgress('Done', 100, 100);
                        if (payload.error) {
                            hybridSearchResultsArea.innerHTML = `<div class="error">Hybrid Search Error: ${escapeHtml(payload.error)}</div>`;
                        } else if (payload.results) {
                            displaySearchResults(payload.results, hybridSearchResultsArea, 'Hybrid Search Results (RRF)');
                        }
                        if (payload.metrics) {
                            // Metrics for hybrid search might be structured differently (e.g., with sub-durations)
                            displayMetrics(payload.metrics, hybridSearchResultsArea);
                        }
                        break;
                    case 'hybrid_search_semantic_results_for_pipeline':
                        // Optionally display intermediate semantic results for debugging hybrid search
                        console.log("Intermediate Semantic Results for Hybrid:", payload.results);
                        // displaySearchResults(payload.results, someDebugArea, 'Hybrid - Semantic Part');
                        break;
                    case 'hybrid_search_bm25_results_for_pipeline':
                        // Optionally display intermediate BM25 results for debugging hybrid search
                        console.log("Intermediate BM25 Results for Hybrid:", payload.results);
                        // displaySearchResults(payload.results, someDebugArea, 'Hybrid - BM25 Part');
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
            let initPayload: any = {};
            if (chatEngineWebLLMRadio.checked && mlcModelSelect) {
                initPayload.mlcModelId = mlcModelSelect.value;
                console.log("RAG Test Main: Sending mlcModelId to worker:", mlcModelSelect.value);
            }
            worker.postMessage({ type: 'initialize', payload: initPayload });
        } catch (error) {
            console.error("RAG Test Main: Error creating Web Worker:", error);
            updateStatus(`Worker error: ${error instanceof Error ? error.message : String(error)}`, true, false);
            progressBarContainer.style.display = 'none';
        }
    }

    submitQueryBtn.addEventListener('click', async () => {
        const query = queryInput.value.trim();
        const systemPrompt = systemPromptInput.value.trim();
        const rephraseTemplate = rephrasePromptTemplateInput.value.trim();
        const finalRagTemplate = finalRagPromptTemplateInput.value.trim();

        // Get chat engine config
        let chatEngineType = 'webllm'; // Default
        if (chatEngineTransformersJSDefaultRadio.checked) {
            chatEngineType = 'transformers';
        } else if (chatEnginePleiasRAGRadio.checked) {
            chatEngineType = 'transformers_pleias';
        } else if (chatEnginePleiasRAG1BRadio.checked) {
            chatEngineType = 'transformers_pleias_1b'; // Assign new type
        }
        // Model ID and ONNX path depend on the type
        let transformersModelId: string | null = null;
        let transformersOnnxFile: string | null = null;
        if (chatEngineType === 'transformers') {
            transformersModelId = transformersModelInput.value.trim();
            transformersOnnxFile = transformersOnnxFileInput.value.trim();
        } else if (chatEngineType === 'transformers_pleias') {
            transformersModelId = 'onnx-community/Pleias-RAG-350M-ONNX';
            transformersOnnxFile = 'onnx/model_quantized.onnx';
        } else if (chatEngineType === 'transformers_pleias_1b') {
            transformersModelId = 'onnx-community/Pleias-RAG-1B-ONNX';
            transformersOnnxFile = 'onnx/model_quantized.onnx'; // Assumed path
        }

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
            if (retrieveContextOriginalBtn) retrieveContextOriginalBtn.disabled = true;
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
                    transformersOnnxFile: chatEngineType === 'transformers' ? transformersOnnxFile : null, // Pass ONNX file path/url
                    rephraseSettings,
                    answerSettings,
                    similarityMetric: similarityMetricSelect.value // Pass selected metric
                }
            });
        }
    });

    if (runSimilarityTestBtn) {
        runSimilarityTestBtn.addEventListener('click', async () => {
            if (!worker || !isWorkerReady) {
                console.warn('Similarity test button clicked, but worker is not ready.');
                statusLabel.textContent = 'Worker not ready. Please wait for initialization.';
                return;
            }
            console.log("Requesting similarity test from worker...");
            const selectedValidationMetric = validationSimilarityMetricSelect.value;
            worker.postMessage({
                type: 'SIMILARITY_TEST_REQUEST',
                payload: { similarityMetric: selectedValidationMetric }
            });
            statusLabel.textContent = 'Running similarity validation...';
            runSimilarityTestBtn.disabled = true;
        });
    }

    // Event Listeners for step-by-step RAG
    if (rephraseQueryBtn) {
        rephraseQueryBtn.addEventListener('click', () => {
            const originalQuery = queryInput.value.trim();
            const rephraseTemplate = rephrasePromptTemplateInput.value.trim();
            const systemPrompt = systemPromptInput.value.trim(); // System prompt might influence rephrasing

            // Get chat engine config
            let chatEngineType = 'webllm'; // Default
            if (chatEngineTransformersJSDefaultRadio.checked) {
                chatEngineType = 'transformers';
            } else if (chatEnginePleiasRAGRadio.checked) {
                chatEngineType = 'transformers_pleias';
            } else if (chatEnginePleiasRAG1BRadio.checked) {
                chatEngineType = 'transformers_pleias_1b'; // Assign new type
            }
            // Model ID and ONNX path depend on the type
            let transformersModelId: string | null = null;
            let transformersOnnxFile: string | null = null;
            if (chatEngineType === 'transformers') {
                transformersModelId = transformersModelInput.value.trim();
                transformersOnnxFile = transformersOnnxFileInput.value.trim();
            } else if (chatEngineType === 'transformers_pleias') {
                transformersModelId = 'onnx-community/Pleias-RAG-350M-ONNX';
                transformersOnnxFile = 'onnx/model_quantized.onnx';
            } else if (chatEngineType === 'transformers_pleias_1b') {
                transformersModelId = 'onnx-community/Pleias-RAG-1B-ONNX';
                transformersOnnxFile = 'onnx/model_quantized.onnx'; // Assumed path
            }

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
                        transformersModelId: transformersModelId, // Pass correct model ID
                        transformersOnnxFile: transformersOnnxFile, // Pass correct ONNX file path/url
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
                        queryForContext,
                        searchAllDocuments: searchAllDocumentsCheckbox.checked, // Pass checkbox state
                        similarityMetric: similarityMetricSelect.value // Pass selected metric
                    }
                });
            }
        });
    }

    if (generateFinalAnswerBtn) {
        generateFinalAnswerBtn.addEventListener('click', () => {
            const finalQuery = currentOriginalQuery; // Use the original query for the final question
            const contextArrayForWorker = currentRetrievedSearchResults; // <<< Use the results array for the worker
            const finalRagTemplate = finalRagPromptTemplateInput.value.trim();
            const systemPrompt = systemPromptInput.value.trim();

            // Get chat engine config
            let chatEngineType = 'webllm'; // Default
            if (chatEngineTransformersJSDefaultRadio.checked) {
                chatEngineType = 'transformers';
            } else if (chatEnginePleiasRAGRadio.checked) {
                chatEngineType = 'transformers_pleias';
            } else if (chatEnginePleiasRAG1BRadio.checked) {
                chatEngineType = 'transformers_pleias_1b'; // Assign new type
            }
            // Model ID and ONNX path depend on the type
            let transformersModelId: string | null = null;
            let transformersOnnxFile: string | null = null;
            if (chatEngineType === 'transformers') {
                transformersModelId = transformersModelInput.value.trim();
                transformersOnnxFile = transformersOnnxFileInput.value.trim();
            } else if (chatEngineType === 'transformers_pleias') {
                transformersModelId = 'onnx-community/Pleias-RAG-350M-ONNX';
                transformersOnnxFile = 'onnx/model_quantized.onnx';
            } else if (chatEngineType === 'transformers_pleias_1b') {
                transformersModelId = 'onnx-community/Pleias-RAG-1B-ONNX';
                transformersOnnxFile = 'onnx/model_quantized.onnx'; // Assumed path
            }

            if (!finalQuery) {
                alert("Original query is missing for final answer generation.");
                return;
            }
            // Adjust check for the array
            if (!contextArrayForWorker) { // Check if the array exists (is not null)
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
                if (retrieveContextBtn) retrieveContextBtn.disabled = true;
                if (rephraseQueryBtn) rephraseQueryBtn.disabled = true;
                if (retrieveContextOriginalBtn) retrieveContextOriginalBtn.disabled = true;

                // Gather answer model settings from UI
                const answerSettings = {
                    temperature: parseFloat(answerTemperatureSlider.value),
                    top_p: parseFloat(answerTopPSlider.value),
                    top_k: parseInt(answerTopKInput.value, 10),
                    max_new_tokens: parseInt(answerMaxNewTokensInput.value, 10)
                };

                // --- Construct and log the final prompt --- >
                let finalPromptForLog = finalRagTemplate;
                if (systemPrompt) {
                    finalPromptForLog = finalPromptForLog.replace('{system_prompt}', systemPrompt);
                } else {
                    // Remove the system prompt block if no system prompt is provided
                    // Adjust this logic if your template handles optional system prompts differently
                    finalPromptForLog = finalPromptForLog.replace(/<\|im_start\|>system\s*{system_prompt}\s*<\|im_end\|>\s*/, '');
                }
                // Log using the display string, as the worker handles the array formatting
                finalPromptForLog = finalPromptForLog.replace('{context}', currentRetrievedContext || '[No context provided]');
                finalPromptForLog = finalPromptForLog.replace('{query}', finalQuery);
                console.log("--- Final Prompt for Generation (Main Thread Log - Display Format) ---");
                console.log(finalPromptForLog);
                console.log("-----------------------------------");
                // < --- End logging ---

                worker.postMessage({
                    type: 'GENERATE_FINAL_ANSWER',
                    payload: {
                        originalQuery: finalQuery, // Use the original query for the final Q
                        context: contextArrayForWorker, // <<< Pass the array to the worker
                        systemPrompt: systemPrompt || null,
                        finalRagPromptTemplate: finalRagTemplate,
                        chatEngineType,
                        transformersModelId: transformersModelId, // Pass correct model ID
                        transformersOnnxFile: transformersOnnxFile, // Pass correct ONNX file path/url
                        answerSettings // Pass all answer model settings
                    }
                });
            }
        });
    }

    // Listener for NEW retrieve context (original query) button
    if (retrieveContextOriginalBtn) {
        retrieveContextOriginalBtn.addEventListener('click', () => {
            const originalQuery = queryInput.value.trim();

            if (!originalQuery) {
                alert("Please enter an original query to retrieve context.");
                return;
            }
            if (worker) {
                updateStatus('Retrieving context (original query)...', false, false);
                if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
                if (rephraseQueryBtn) rephraseQueryBtn.disabled = true;
                if (retrieveContextBtn) retrieveContextBtn.disabled = true;
                retrievedContextArea.textContent = 'Retrieving... (using original query)';
                responseArea.textContent = ''; // Clear old response

                worker.postMessage({
                    type: 'RETRIEVE_CONTEXT',
                    payload: {
                        queryForContext: originalQuery,
                        searchAllDocuments: searchAllDocumentsCheckbox.checked, // Pass checkbox state
                        similarityMetric: similarityMetricSelect.value // Pass selected metric
                    }
                });
            }
        });
    }

    // Add listener to enable/disable retrieveContextOriginalBtn based on query input
    queryInput.addEventListener('input', () => {
        if (retrieveContextOriginalBtn) {
            retrieveContextOriginalBtn.disabled = !queryInput.value.trim() || submitQueryBtn.disabled; // Also check if system is busy
        }
    });

    // Clean up worker when page is about to be unloaded
    window.addEventListener('beforeunload', () => {
        if ((window as any).ragWorker) {
            console.log("RAG Test Main: Page unloading. Requesting worker to dispose engines.");
            (window as any).ragWorker.postMessage({ type: 'dispose' });
        }
    });

    // Initialize the worker after setting up listeners
    initializeWorker();

    // --- Vite HMR Handling for Worker ---
    if (import.meta.hot) {
        import.meta.hot.accept('/src/rag-testing/rag_worker.ts?worker', (newWorkerModule) => {
            console.log('RAG Test Main: HMR detected update for rag_worker.ts. Re-initializing worker...');
            // The newWorkerModule might be useful if the import mechanism changes,
            // but for now, simply re-running initializeWorker should pick up the new code
            // because it calls `new RagWorker()` again.
            initializeWorker(); // This will terminate the old and start a new one
        });
    }
    // --- End HMR Handling ---

    function displaySimilarityResults(payload: {
        results: Array<{ pair: string, webLLMScore: number | string, transformersScore: number | string, details?: string }>
        metricUsed?: string
    }) {
        const resultsArea = document.getElementById('similarityResultsArea');
        if (!resultsArea) return;

        let html = '<table><thead><tr><th>Text Pair</th><th>WebLLM (Xenova) Score</th><th>In-browser Transformers.js Score</th><th>Details</th></tr></thead><tbody>';
        if (payload.metricUsed) {
            const metricName = payload.metricUsed.charAt(0).toUpperCase() + payload.metricUsed.slice(1);
            html = `<h4>Metric used: ${metricName.replace('_', ' ')}</h4>` + html;
        }

        for (const item of payload.results) {
            html += `<tr><td>${item.pair}</td><td>${item.webLLMScore}</td><td>${item.transformersScore}</td><td>${item.details || 'N/A'}</td></tr>`;
        }
        html += '</tbody></table>';
        resultsArea.innerHTML = html;
    }

    // --- Event Listeners ---
    if (searchModeSelect) {
        searchModeSelect.addEventListener('change', () => {
            const selectedMode = searchModeSelect.value;
            if (bm25ParamsDiv) {
                bm25ParamsDiv.style.display = (selectedMode === 'bm25' || selectedMode === 'hybrid') ? 'block' : 'none';
            }
            if (rrfParamsDiv) {
                rrfParamsDiv.style.display = (selectedMode === 'hybrid') ? 'block' : 'none';
            }
            // Potentially hide/show other sections like full RAG prompt inputs if only doing retrieval
            if (selectedMode === 'bm25') {
                responseArea.innerHTML = ''; // Clear full RAG response area
                retrievedContextArea.innerHTML = ''; // Clear semantic context area
                hybridSearchResultsArea.innerHTML = '';
            } else if (selectedMode === 'hybrid') {
                responseArea.innerHTML = '';
                retrievedContextArea.innerHTML = '';
                bm25ResultsArea.innerHTML = '';
            } else { // Semantic (full RAG)
                bm25ResultsArea.innerHTML = '';
                hybridSearchResultsArea.innerHTML = '';
            }
        });
        // Trigger change once to set initial visibility
        searchModeSelect.dispatchEvent(new Event('change'));
    }

    // Function to display search results (can be adapted from displayRetrievedContext)
    function displaySearchResults(results: SearchResult[], targetArea: HTMLElement, title: string) {
        if (!results || results.length === 0) {
            targetArea.innerHTML = `<p>${title}: No results found.</p>`;
            return;
        }
        let html = `<h3>${title} (Top ${results.length})</h3><ul>`;
        results.forEach(result => {
            const textSnippet = result.text ? escapeHtml(result.text.substring(0, 200) + (result.text.length > 200 ? '...' : '')) : 'N/A';
            const docTitle = result.metadata?.name || result.id; // Assuming title is in metadata.name
            html += `<li>
                <strong>ID:</strong> ${escapeHtml(result.id)}<br/>
                <strong>Title:</strong> ${escapeHtml(docTitle)}<br/>
                <strong>Score:</strong> ${result.score.toFixed(4)}<br/>
                <strong>Text:</strong> ${textSnippet}
            </li>`;
        });
        html += '</ul>';
        targetArea.innerHTML = html;
    }

    // Function to display metrics (can be adapted)
    function displayMetrics(metrics: any, targetArea: HTMLElement) {
        let metricsHtml = '<div class="metrics"><h4>Metrics:</h4><ul>';
        for (const key in metrics) {
            if (typeof metrics[key] === 'number') {
                metricsHtml += `<li>${key}: ${metrics[key].toFixed(2)} ms</li>`;
            } else {
                metricsHtml += `<li>${key}: ${metrics[key]}</li>`;
            }
        }
        metricsHtml += '</ul></div>';
        const metricsDiv = document.createElement('div');
        metricsDiv.innerHTML = metricsHtml;
        targetArea.appendChild(metricsDiv.firstChild || document.createTextNode('')); // Append only the content of metricsDiv
    }

}); 