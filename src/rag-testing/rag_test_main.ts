console.log("RAG Test Main: Script loaded.");

// Import the worker using Vite's ?worker syntax
import RagWorker from '/src/rag-testing/rag_worker.ts?worker';
// Dynamically import transformers.js for in-browser use
import { pipeline, env as CjsEnv } from '@huggingface/transformers';

// Make Transformers.js available globally for the inline script in rag-test.astro
(window as any).transformers = { pipeline, env: CjsEnv };

import type { SearchResult } from '../types/vectorStore';
// import type { QueryPayload, RephraseQueryPayload } from '../types/chatTypes'; // Commented out due to missing file

// Import the specific embedding model ID from siteConfig
import { WEBLLM_EMBEDDING_MODEL_ID } from '../siteConfig'; // Corrected path

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
    const bm25FilterKmeansKInput = document.getElementById('bm25FilterKmeansKInput') as HTMLInputElement; // Added
    const rrfParamsDiv = document.getElementById('rrfParamsDiv') as HTMLDivElement;
    const rrfKInput = document.getElementById('rrfKInput') as HTMLInputElement;
    const hybridTopNInput = document.getElementById('hybridTopNInput') as HTMLInputElement; // Or a shared topN
    const bm25ResultsArea = document.getElementById('bm25ResultsArea') as HTMLDivElement;
    const hybridSearchResultsArea = document.getElementById('hybridSearchResultsArea') as HTMLDivElement;
    // --- End Elements for Hybrid Search PoC ---

    // --- NEW: Elements for Dedicated BM25 Test ---
    const testBm25OnlyBtn = document.getElementById('testBm25OnlyBtn') as HTMLButtonElement;
    const dedicatedBm25TestResultsArea = document.getElementById('dedicatedBm25TestResultsArea') as HTMLDivElement;
    // --- END: Elements for Dedicated BM25 Test ---

    // --- NEW: Elements for Rephrase Strategy Selection ---
    const rephraseStrategySelect = document.getElementById('rephraseStrategySelect') as HTMLSelectElement;
    const llmRephraseSettingsDivForPrompt = document.getElementById('llmRephraseSettingsDivForPrompt') as HTMLDivElement;
    const llmRephraseSettingsDivForModel = document.getElementById('llmRephraseSettingsDivForModel') as HTMLDivElement;
    // --- END: Elements for Rephrase Strategy Selection ---

    // --- Add references to the new embedding info divs ---
    // const webllmEmbeddingInfo = document.getElementById('webllmEmbeddingInfo') as HTMLDivElement; // REMOVE
    // const transformersDefaultEmbeddingInfo = document.getElementById('transformersDefaultEmbeddingInfo') as HTMLDivElement; // REMOVE
    // const pleias350mEmbeddingInfo = document.getElementById('pleias350mEmbeddingInfo') as HTMLDivElement; // REMOVE
    // const pleias1bEmbeddingInfo = document.getElementById('pleias1bEmbeddingInfo') as HTMLDivElement; // REMOVE
    // const webllmEmbeddingModelNameSpan = document.getElementById('webllmEmbeddingModelName') as HTMLSpanElement; // REMOVE, replaced by ragEmbeddingModelNameSpan
    const ragEmbeddingModelNameSpan = document.getElementById('ragEmbeddingModelName') as HTMLSpanElement; // ADDED for the new centralized display
    // --- END Add references --- 

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
        retrieveContextOriginalBtn,
        mlcModelSelectDiv,
        mlcModelSelect,
        searchAllDocumentsCheckbox,
        similarityMetricSelect,
        searchModeSelect,
        bm25ParamsDiv,
        bm25K1Input,
        bm25BInput,
        bm25FilterKmeansKInput, // Added
        rrfParamsDiv,
        rrfKInput,
        hybridTopNInput,
        bm25ResultsArea,
        hybridSearchResultsArea,
        testBm25OnlyBtn, // Added
        dedicatedBm25TestResultsArea, // Added
        // --- NEW: Add rephrase strategy elements to required list ---
        rephraseStrategySelect,
        llmRephraseSettingsDivForPrompt,
        llmRephraseSettingsDivForModel,
        // --- END: Add rephrase strategy elements to required list ---
        // --- Add new embedding info divs to required list (optional, can be handled if not found) ---
        // webllmEmbeddingInfo, // REMOVE
        // transformersDefaultEmbeddingInfo, // REMOVE
        // pleias350mEmbeddingInfo, // REMOVE
        // pleias1bEmbeddingInfo, // REMOVE
        // webllmEmbeddingModelNameSpan // REMOVE
        ragEmbeddingModelNameSpan // ADDED
        // --- END Add new embedding info divs ---
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

    // Expose for RAG table script in rag-test.astro
    (window as any).currentRephrasedQueryForTable = null;

    // Store default prompt template values
    let defaultRephraseTemplate = '';
    let defaultFinalRagTemplate = '';

    // --- NEW: Store current user-set prompt templates ---
    let currentUserRephraseTemplate = '';
    let currentUserFinalRagTemplate = '';
    // --- END NEW ---

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

    // --- NEW: Store current user-set generation settings ---
    let currentUserAnswerSettings = { ...defaultAnswerSettings };
    let currentUserRephraseSettings = { ...defaultRephraseSettings };
    // --- END NEW ---

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

            // Restore Answer settings FROM currentUserAnswerSettings
            answerTemperatureSlider.value = currentUserAnswerSettings.temperature;
            answerTemperatureValue.textContent = currentUserAnswerSettings.temperature;
            answerTemperatureSlider.disabled = submitQueryBtn.disabled;

            answerTopPSlider.value = currentUserAnswerSettings.top_p;
            answerTopPValue.textContent = currentUserAnswerSettings.top_p;
            answerTopPSlider.disabled = submitQueryBtn.disabled;

            answerTopKInput.value = currentUserAnswerSettings.top_k;
            answerTopKInput.disabled = submitQueryBtn.disabled;

            answerMaxNewTokensInput.value = currentUserAnswerSettings.max_new_tokens;
            answerMaxNewTokensInput.max = "32768"; // Restore original higher max
            answerMaxNewTokensInput.disabled = submitQueryBtn.disabled;

            // Restore Rephrase settings FROM currentUserRephraseSettings
            if (rephraseSettingsContainer) (rephraseSettingsContainer as HTMLElement).style.display = 'block'; // or original display
            rephraseTemperatureSlider.disabled = submitQueryBtn.disabled;
            rephraseTemperatureSlider.value = currentUserRephraseSettings.temperature;
            rephraseTemperatureValue.textContent = currentUserRephraseSettings.temperature;

            rephraseTopPSlider.disabled = submitQueryBtn.disabled;
            rephraseTopPSlider.value = currentUserRephraseSettings.top_p;
            rephraseTopPValue.textContent = currentUserRephraseSettings.top_p;

            rephraseTopKInput.disabled = submitQueryBtn.disabled;
            rephraseTopKInput.value = currentUserRephraseSettings.top_k;

            rephraseMaxNewTokensInput.disabled = submitQueryBtn.disabled;
            rephraseMaxNewTokensInput.value = currentUserRephraseSettings.max_new_tokens;
            rephraseMaxNewTokensInput.max = "32768"; // Restore original higher max
        }
    }

    // Helper function to update prompt templates
    function updatePromptTemplates(isPleias: boolean, mlcModelId?: string) {
        let specificConfigApplied = false;

        if (isPleias) {
            // Apply Pleias specific templates
            rephrasePromptTemplateInput.value = `<|query_start|>{query}<|query_end|>\n<|source_analysis_start|>`;
            finalRagPromptTemplateInput.value = `<|query_start|>{query}<|query_end|>\n{context}\n<|source_analysis_start|>`;
            if (systemPromptContainer) systemPromptContainer.style.display = 'none';
            specificConfigApplied = true;
        } else if (chatEngineWebLLMRadio?.checked && mlcModelId) {
            // Check if there's a specific (non-default) config for this MLC model
            const modelSpecificConfig = mlcModelPromptConfigs[mlcModelId];
            // Ensure DEFAULT_WEBLLM is not treated as a specific user-overridable config here.
            // It's a fallback for initialization, but currentUser... should take precedence during updates for generic WebLLM.
            if (modelSpecificConfig && mlcModelPromptConfigs[mlcModelId] !== mlcModelPromptConfigs['DEFAULT_WEBLLM']) {
                rephrasePromptTemplateInput.value = modelSpecificConfig.rephrase;
                finalRagPromptTemplateInput.value = modelSpecificConfig.finalRag;
                if (systemPromptContainer) systemPromptContainer.style.display = modelSpecificConfig.showSystemPromptInput ? '' : 'none';
                specificConfigApplied = true;
            }
        }

        if (!specificConfigApplied) {
            // This case covers:
            // 1. Custom Transformers.js (not Pleias, not WebLLM)
            // 2. WebLLM with a model that doesn't have a specific template override in mlcModelPromptConfigs
            rephrasePromptTemplateInput.value = currentUserRephraseTemplate;
            finalRagPromptTemplateInput.value = currentUserFinalRagTemplate;
            if (systemPromptContainer) systemPromptContainer.style.display = ''; // Default to show system prompt input
        }

        // Ensure inputs are enabled/disabled based on overall system readiness
        rephrasePromptTemplateInput.disabled = submitQueryBtn.disabled;
        finalRagPromptTemplateInput.disabled = submitQueryBtn.disabled;
    }

    // --- Event listeners for chat engine selection ---+
    function handleChatEngineChange() {
        const qwenModelId = 'onnx-community/Qwen3-0.6B-ONNX';
        const qwenOnnxPath = 'onnx/model_q4.onnx';
        const pleiasModelId = 'onnx-community/Pleias-RAG-350M-ONNX';
        const pleiasOnnxPath = 'onnx/model_quantized.onnx'; // Correct path
        const pleias1BModelId = 'onnx-community/Pleias-RAG-1B-ONNX'; // New 1B model ID
        const pleias1BOnnxPath = 'onnx/model_quantized.onnx'; // Assuming same quantized path for 1B

        // Update the RAG embedding model name display - REMOVED, set once on load
        // if (ragEmbeddingModelNameSpan) { 
        //     if (chatEngineWebLLMRadio?.checked && mlcModelSelect.selectedOptions.length > 0) {
        //         ragEmbeddingModelNameSpan.textContent = mlcModelSelect.selectedOptions[0].text;
        //     } else if (chatEngineWebLLMRadio?.checked) { // WebLLM checked but no option selected (e.g. if list was empty)
        //          ragEmbeddingModelNameSpan.textContent = WEBLLM_EMBEDDING_MODEL_ID; // Fallback to siteConfig default if WebLLM chosen but no specific model selected
        //     } else {
        //         // For Transformers.js engines, WebLLMService uses the siteConfig default for embeddings.
        //         ragEmbeddingModelNameSpan.textContent = WEBLLM_EMBEDDING_MODEL_ID;
        //     }
        // }

        if (chatEngineWebLLMRadio?.checked) {
            transformersModelInputDiv.style.display = 'none';
            transformersModelInput.disabled = true;
            transformersOnnxFileInput.disabled = true;
            mlcModelSelectDiv.style.display = 'block'; // Show MLC select
            mlcModelSelect.disabled = submitQueryBtn.disabled; // Enable/disable based on system readiness
            updatePromptTemplates(false, mlcModelSelect.value); // Pass selected MLC model
            updateGenerationSettingsUI(false); // Restore default generation settings

            // --- SMOLlm2 max_new_tokens override START ---
            const selectedMlcModelId = mlcModelSelect.value;
            if (selectedMlcModelId.toLowerCase().includes('smollm2')) {
                if (answerMaxNewTokensInput) answerMaxNewTokensInput.value = "8192";
                if (rephraseMaxNewTokensInput) rephraseMaxNewTokensInput.value = "8192";
            }
            // --- SMOLlm2 max_new_tokens override END ---

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
            // if (pleias1bEmbeddingInfo) pleias1bEmbeddingInfo.style.display = 'block'; // REMOVE
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
            // if (pleias350mEmbeddingInfo) pleias350mEmbeddingInfo.style.display = 'block'; // REMOVE
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
            // if (transformersDefaultEmbeddingInfo) transformersDefaultEmbeddingInfo.style.display = 'block'; // REMOVE
        } else {
            // Default case or error, hide the div
            transformersModelInputDiv.style.display = 'none';
            transformersModelInput.disabled = true;
            transformersOnnxFileInput.disabled = true;
            updatePromptTemplates(false); // Restore default prompts (safety)
            updateGenerationSettingsUI(false); // Restore default generation settings (safety)
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = true; // Disable rephrase button (safety)
            // This logic is now centralized at the top of handleChatEngineChange
            // if (webllmEmbeddingModelNameSpan && mlcModelSelect.selectedOptions.length > 0) { 
            //     webllmEmbeddingModelNameSpan.textContent = mlcModelSelect.selectedOptions[0].text;
            // } else if (webllmEmbeddingModelNameSpan) {
            //     webllmEmbeddingModelNameSpan.textContent = "Default MLC Model"; // Fallback or if no option selected
            // }
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
            // Ensure mlcModelSelectDiv visibility is also correctly handled here
            if (mlcModelSelectDiv) {
                mlcModelSelectDiv.style.display = webLlmEngineSelected ? 'block' : 'none';
            }
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

                // Update the RAG embedding model name display when MLC model changes AND WebLLM engine is active -- REMOVED
                // if (ragEmbeddingModelNameSpan && mlcModelSelect.selectedOptions.length > 0) {
                //     ragEmbeddingModelNameSpan.textContent = mlcModelSelect.selectedOptions[0].text;
                // }

                // --- SMOLlm2 max_new_tokens override START ---
                const selectedMlcModelIdOnChange = mlcModelSelect.value;
                if (selectedMlcModelIdOnChange.toLowerCase().includes('smollm2')) {
                    if (answerMaxNewTokensInput) answerMaxNewTokensInput.value = "8192";
                    if (rephraseMaxNewTokensInput) rephraseMaxNewTokensInput.value = "8192";
                } else {
                    // Revert to defaults if not a smollm2 model but still WebLLM
                    if (answerMaxNewTokensInput) answerMaxNewTokensInput.value = defaultAnswerSettings.max_new_tokens;
                    if (rephraseMaxNewTokensInput) rephraseMaxNewTokensInput.value = defaultRephraseSettings.max_new_tokens;
                }
                // --- SMOLlm2 max_new_tokens override END ---

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

    // --- NEW: Initialize currentUser...Templates after defaults are properly set from DOM ---
    currentUserRephraseTemplate = defaultRephraseTemplate;
    currentUserFinalRagTemplate = defaultFinalRagTemplate;

    // --- NEW: Add event listeners to prompt template inputs ---
    if (rephrasePromptTemplateInput) {
        rephrasePromptTemplateInput.addEventListener('input', () => {
            // Update currentUser template only if not in Pleias mode
            if (!chatEnginePleiasRAGRadio.checked && !chatEnginePleiasRAG1BRadio.checked) {
                currentUserRephraseTemplate = rephrasePromptTemplateInput.value;
            }
        });
    }
    if (finalRagPromptTemplateInput) {
        finalRagPromptTemplateInput.addEventListener('input', () => {
            // Update currentUser template only if not in Pleias mode
            if (!chatEnginePleiasRAGRadio.checked && !chatEnginePleiasRAG1BRadio.checked) {
                currentUserFinalRagTemplate = finalRagPromptTemplateInput.value;
            }
        });
    }
    // --- END NEW ---

    // Setup for minContextScoreSlider, its value display, and metric select interaction
    // if (minContextScoreSlider && minContextScoreValue && similarityMetricSelect) { // REMOVE BLOCK
    //     minContextScoreSlider.addEventListener('input', updateMinScoreContextAndDisplay);
    //     similarityMetricSelect.addEventListener('change', updateMinScoreContextAndDisplay);
    //     // Initial setup call after all elements are known and event listeners attached
    //     updateMinScoreContextAndDisplay();
    // } else {
    //     console.warn("RAG Test Main: MinContextScore UI elements (slider, value, or metricSelect) not found. Score threshold UI may not function correctly.");
    // }

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

    // --- NEW: Initialize currentUser...Settings after defaults are properly set from DOM ---
    currentUserAnswerSettings = { ...defaultAnswerSettings };
    currentUserRephraseSettings = { ...defaultRephraseSettings };

    // --- NEW: Add event listeners to generation settings UI to update currentUser...Settings ---
    const generationSettingInputs = [
        { el: answerTemperatureSlider, settingsObj: currentUserAnswerSettings, key: 'temperature', isSlider: true, valueEl: answerTemperatureValue },
        { el: answerTopPSlider, settingsObj: currentUserAnswerSettings, key: 'top_p', isSlider: true, valueEl: answerTopPValue },
        { el: answerTopKInput, settingsObj: currentUserAnswerSettings, key: 'top_k', isSlider: false },
        { el: answerMaxNewTokensInput, settingsObj: currentUserAnswerSettings, key: 'max_new_tokens', isSlider: false },
        { el: rephraseTemperatureSlider, settingsObj: currentUserRephraseSettings, key: 'temperature', isSlider: true, valueEl: rephraseTemperatureValue },
        { el: rephraseTopPSlider, settingsObj: currentUserRephraseSettings, key: 'top_p', isSlider: true, valueEl: rephraseTopPValue },
        { el: rephraseTopKInput, settingsObj: currentUserRephraseSettings, key: 'top_k', isSlider: false },
        { el: rephraseMaxNewTokensInput, settingsObj: currentUserRephraseSettings, key: 'max_new_tokens', isSlider: false }
    ];

    generationSettingInputs.forEach(inputConfig => {
        if (inputConfig.el) {
            inputConfig.el.addEventListener('input', () => {
                if (inputConfig.isSlider && inputConfig.valueEl) {
                    inputConfig.valueEl.textContent = inputConfig.el.value;
                }
                // Update currentUser settings only if not in Pleias mode
                if (!chatEnginePleiasRAGRadio.checked && !chatEnginePleiasRAG1BRadio.checked) {
                    (inputConfig.settingsObj as any)[inputConfig.key] = inputConfig.el.value;
                }
            });
        }
    });
    // --- END NEW ---

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
            if (retrieveContextBtn) retrieveContextBtn.disabled = true; // This is managed by specific steps
            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true; // This is managed by specific steps
            if (retrieveContextOriginalBtn) retrieveContextOriginalBtn.disabled = !isReady || !queryInput.value.trim();
            if (testBm25OnlyBtn) testBm25OnlyBtn.disabled = !isReady; // Added

            // Remove direct disabling/enabling of chat engine UI elements here,
            // as handleChatEngineChange will manage them more comprehensively.
            // Example:
            // // if (chatEngineWebLLMRadio) chatEngineWebLLMRadio.disabled = !isReady;
            // // if (mlcModelSelect) mlcModelSelect.disabled = !isReady || !chatEngineWebLLMRadio.checked;

            // Call handleChatEngineChange to refresh the entire chat engine UI section
            // based on the new readiness state and current selections.
            // This will also call updateGenerationSettingsUI internally.
            if (typeof handleChatEngineChange === 'function') {
                handleChatEngineChange();
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

            // Helper to re-enable the main submit button and related step-by-step buttons
            const reEnableSubmitButton = () => {
                if (submitQueryBtn) {
                    submitQueryBtn.disabled = false;
                    submitQueryBtn.textContent = 'Run Full RAG Pipeline';
                }
                // Also re-enable step-by-step buttons if they exist and were part of a flow
                // This might need more granular control depending on exact flow and if system is truly ready
                if (rephraseQueryBtn && isWorkerReady) rephraseQueryBtn.disabled = false;
                // retrieveContextBtn and generateFinalAnswerBtn are typically enabled by specific preceding successful steps,
                // so they are not generically re-enabled here. Their state is managed by 'REPHRASED_QUERY_RESULT' and 'RETRIEVED_CONTEXT_RESULT' handlers.
                if (retrieveContextOriginalBtn && isWorkerReady && queryInput.value.trim()) retrieveContextOriginalBtn.disabled = false;
                if (testBm25OnlyBtn && isWorkerReady) testBm25OnlyBtn.disabled = false;

                // Re-enable chat engine selection if worker is ready
                if (isWorkerReady) {
                    if (chatEngineWebLLMRadio) chatEngineWebLLMRadio.disabled = false;
                    if (chatEnginePleiasRAGRadio) chatEnginePleiasRAGRadio.disabled = false;
                    if (chatEngineTransformersJSDefaultRadio) chatEngineTransformersJSDefaultRadio.disabled = false;
                    if (chatEnginePleiasRAG1BRadio) chatEnginePleiasRAG1BRadio.disabled = false;
                    if (mlcModelSelect) mlcModelSelect.disabled = !chatEngineWebLLMRadio.checked; // Only enable if WebLLM is selected
                    if (transformersModelInput) transformersModelInput.disabled = !chatEngineTransformersJSDefaultRadio.checked;
                    if (transformersOnnxFileInput) transformersOnnxFileInput.disabled = !chatEngineTransformersJSDefaultRadio.checked;
                }
                if (progressBarContainer) progressBarContainer.style.display = 'none';
            };

            worker.onmessage = (event: MessageEvent) => {
                console.log("RAG Test Main: Raw event.data from worker:", event.data);
                try {
                    console.log("RAG Test Main: Raw event.data from worker (stringified):", JSON.stringify(event.data));
                } catch (e) {
                    console.warn("RAG Test Main: Could not stringify event.data from worker.", e);
                }

                // Ensure event.data is an object before destructuring
                if (typeof event.data !== 'object' || event.data === null) {
                    console.error("RAG Test Main: Received non-object event.data from worker:", event.data);
                    updateStatus("Error: Invalid message format from worker.", true);
                    return;
                }

                const { type, payload, message, error, data: workerData } = event.data;

                // Update UI based on worker messages
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
                    case 'response': // This handles final answers from full RAG or hybrid (with generation)
                        responseArea.innerHTML = ''; // Clear previous response
                        if (payload.error) {
                            responseArea.innerHTML = `<p class="error-message">Error: ${escapeHtml(payload.error)}</p>`;
                            updateStatus(`Error processing query: ${payload.error}`, true, true);
                        } else {
                            // Display the main result
                            let responseHtml = highlightThinkBlocks(escapeHtml(payload.result || 'No textual result from LLM.'));

                            // Add inline LLM generation metrics if available from this response
                            if (payload.metrics && payload.metrics.generationTime !== undefined) {
                                responseHtml += `<br><small style="color:grey;">`;
                                responseHtml += `(LLM Gen: ${payload.metrics.generationTime.toFixed(0)}ms`;
                                if (payload.metrics.totalTokens !== undefined && payload.metrics.tokensPerSecond !== undefined && payload.metrics.generationTime > 0) {
                                    responseHtml += `, ${payload.metrics.totalTokens} tk, ${payload.metrics.tokensPerSecond.toFixed(2)} tk/s`;
                                }
                                responseHtml += `)</small>`;
                            }
                            responseArea.innerHTML = `<p>${responseHtml.replace(/\n/g, '<br>')}</p>`;
                            updateStatus('Query processed successfully.', false, true);

                            // The comprehensive performance metrics are handled by a separate 'performanceMetrics' message
                            // and displayed by updatePerformanceMetricsDisplay.
                        }
                        reEnableSubmitButton(); // Re-enable after processing response
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
                        console.log("Main: Handling REPHRASED_QUERY_RESULT. Type:", type, "Payload from destructuring:", payload, "Full event.data:", event.data);

                        if (!payload) {
                            console.error("Main: REPHRASED_QUERY_RESULT received, but payload from destructuring is undefined/falsey. Full event.data:", event.data);
                            updateStatus("Error: Rephrased query payload missing or invalid.", true);
                            rephrasedQueryArea.innerHTML = `<p class="text-red-500">Error: Rephrased query payload missing or invalid.</p>`;
                            currentOriginalQuery = '';
                            currentRephrasedQuery = '';
                            return;
                        }
                        const { rephrasedQuery, originalQuery: receivedOriginalQuery, strategy: rephraseStrategyUsed, metrics } = payload;
                        currentRephrasedQuery = rephrasedQuery;
                        currentOriginalQuery = receivedOriginalQuery; // Update currentOriginalQuery based on what was rephrased

                        // Update for RAG table access
                        if (rephraseStrategyUsed === 'rule-based') {
                            (window as any).currentRephrasedQueryForTable = currentRephrasedQuery;
                        } else {
                            // If LLM rephrase was used, table might not use it directly or note it.
                            // For now, clear it if not rule-based, or decide later if LLM-rephrased should be used by table.
                            (window as any).currentRephrasedQueryForTable = null;
                        }

                        let rephraseHtml = currentRephrasedQuery ? highlightThinkBlocks(escapeHtml(currentRephrasedQuery)) : 'No rephrased query returned.';
                        const duration = metrics?.duration;
                        const tokenCount = metrics?.generatedTokenCount;

                        if (duration !== undefined) {
                            rephraseHtml += `<br><small style="color:grey;">(Duration: ${(duration / 1000).toFixed(2)}s`;
                            if (tokenCount !== undefined && duration > 0) {
                                const tkPerS = (tokenCount / (duration / 1000)).toFixed(2);
                                rephraseHtml += `, ${tokenCount} tk, ${tkPerS} tk/s`;
                            }
                            rephraseHtml += `)</small>`;
                        }
                        rephrasedQueryArea.innerHTML = rephraseHtml;
                        updateStatus(`Standalone rephrase complete. Ready for context retrieval.`, false, true);

                        // Clear subsequent steps' outputs
                        currentRetrievedContext = null;
                        currentRetrievedSearchResults = null; // Clear results array too
                        retrievedContextArea.textContent = "";
                        responseArea.textContent = "";

                        // Re-enable buttons for next steps
                        if (rephraseQueryBtn) rephraseQueryBtn.disabled = false;
                        if (retrieveContextBtn) retrieveContextBtn.disabled = !currentRephrasedQuery; // Enable if rephrase succeeded
                        if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true; // Keep final answer disabled until context is retrieved
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
                            // Directly use searchResults, as filtering is removed.
                            contextHtml = searchResults.map((result: { text: string; score: number }) => {
                                return `<div style="margin-bottom: 5px; border-bottom: 1px dashed #ccc; padding-bottom: 5px;">
                                            <strong style="color: #007bff;">(Score: ${result.score.toFixed(4)})</strong><br>
                                            ${escapeHtml(result.text)}
                                        </div>`;
                            }).join('');

                            // Store the TEXT content of ALL results for the final answer step
                            currentRetrievedContext = searchResults.map((r: { text: string }) => r.text).join('\n\n---\n\n');
                            // Store ALL SearchResult objects
                            currentRetrievedSearchResults = searchResults;

                            updateStatus(`Context retrieved (${searchResults.length} documents). Ready for final answer generation.`, false, true);
                            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = false; // Enable final answer generation
                        }
                        // Removed old "if (filteredResults.length === 0)" block as all results are now used or it's handled by the initial searchResults check.

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
                                const duration = payload.metrics.duration;
                                const tokenCount = payload.metrics.generatedTokenCount;
                                finalAnswerHtml += `<br><small style="color:grey;">(Duration: ${duration?.toFixed(0)}ms`;
                                if (tokenCount !== undefined && duration !== undefined && duration > 0) {
                                    const tkPerS = (tokenCount / (duration / 1000)).toFixed(2);
                                    finalAnswerHtml += `, ${tokenCount} tk, ${tkPerS} tk/s`;
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
                        if (submitQueryBtn) submitQueryBtn.disabled = false; // Re-enable main button
                        if (testBm25OnlyBtn) testBm25OnlyBtn.disabled = false; // Re-enable dedicated test button
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
                    case 'DEDICATED_BM25_TEST_RESULTS': // Added new case
                        isWorkerReady = true;
                        updateProgress('Done', 100, 100);
                        if (submitQueryBtn) submitQueryBtn.disabled = false;
                        if (testBm25OnlyBtn) testBm25OnlyBtn.disabled = false;
                        if (payload.error) {
                            dedicatedBm25TestResultsArea.innerHTML = `<div class="error">Dedicated BM25 Test Error: ${escapeHtml(payload.error)}</div>`;
                        } else if (payload.results) {
                            displaySearchResults(payload.results, dedicatedBm25TestResultsArea, 'Dedicated BM25 Test Results');
                        }
                        if (payload.metrics) {
                            displayMetrics(payload.metrics, dedicatedBm25TestResultsArea);
                        }
                        break;
                    case 'hybrid_search_semantic_results_for_pipeline':
                        // Display semantic results in the retrieved context area for hybrid pipeline view
                        // This helps visualize the semantic part before BM25 and fusion
                        if (payload.results) {
                            displaySearchResults(payload.results, retrievedContextArea, 'Hybrid - Semantic Context Candidates:');
                        }
                        break;
                    case 'hybrid_search_bm25_results_for_pipeline':
                        // Display BM25 results in its dedicated area for hybrid pipeline view
                        if (payload.results) {
                            const topNForDisplay = 20; // Define how many BM25 candidates to show in this intermediate view
                            const truncatedResults = payload.results.slice(0, topNForDisplay);
                            const title = `Hybrid - BM25 Context Candidates (Top ${truncatedResults.length} of ${payload.results.length}):`;
                            displaySearchResults(truncatedResults, bm25ResultsArea, title);
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
            let initPayload: any = {};
            if (chatEngineWebLLMRadio.checked && mlcModelSelect) {
                initPayload.mlcModelId = mlcModelSelect.value;
                console.log("RAG Test Main: Sending mlcModelId to worker:", mlcModelSelect.value);
            }
            worker.postMessage({ type: 'INIT', payload: initPayload });
        } catch (error) {
            console.error("RAG Test Main: Error creating Web Worker:", error);
            updateStatus(`Worker error: ${error instanceof Error ? error.message : String(error)}`, true, false);
            progressBarContainer.style.display = 'none';
        }
    }

    submitQueryBtn.addEventListener('click', async () => {
        const query = queryInput.value.trim();
        const systemPrompt = systemPromptInput.value.trim(); // Used for semantic/hybrid RAG final answer
        const rephraseTemplate = rephrasePromptTemplateInput.value.trim(); // Used for semantic/hybrid RAG rephrase
        const finalRagTemplate = finalRagPromptTemplateInput.value.trim(); // Used for semantic/hybrid RAG final answer
        const selectedSearchMode = searchModeSelect.value;

        // Common params for all modes that might use them
        const k1 = parseFloat(bm25K1Input.value);
        const b = parseFloat(bm25BInput.value);
        const k_rrf = parseInt(rrfKInput.value, 10);
        const topN = parseInt(hybridTopNInput.value, 10);
        const currentSimilarityMetric = similarityMetricSelect.value;
        const bm25FilterK = parseInt(bm25FilterKmeansKInput.value, 10); // Added

        // Get chat engine config (relevant for semantic/hybrid generative steps)
        let chatEngineType = 'webllm';
        if (chatEngineTransformersJSDefaultRadio.checked) chatEngineType = 'transformers';
        else if (chatEnginePleiasRAGRadio.checked) chatEngineType = 'transformers_pleias';
        else if (chatEnginePleiasRAG1BRadio.checked) chatEngineType = 'transformers_pleias_1b';

        let transformersModelId: string | null = null;
        let transformersOnnxFile: string | null = null;
        if (chatEngineType.startsWith('transformers')) {
            if (chatEngineType === 'transformers_pleias') {
                transformersModelId = 'onnx-community/Pleias-RAG-350M-ONNX';
                transformersOnnxFile = 'onnx/model_quantized.onnx';
            } else if (chatEngineType === 'transformers_pleias_1b') {
                transformersModelId = 'onnx-community/Pleias-RAG-1B-ONNX';
                transformersOnnxFile = 'onnx/model_quantized.onnx';
            } else { // 'transformers' (custom/default)
                transformersModelId = transformersModelInput.value.trim();
                transformersOnnxFile = transformersOnnxFileInput.value.trim();
            }
        }

        // Gather rephrase and answer settings (for semantic/hybrid generative steps)
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

        if (worker) {
            // Clear previous results specific to search modes
            bm25ResultsArea.innerHTML = '';
            hybridSearchResultsArea.innerHTML = '';
            // Response area might be cleared or used by different modes
            // For BM25 only, clear it. For hybrid, it might show final generative answer.
            // For semantic, it's the main output.
            if (selectedSearchMode === 'bm25') responseArea.innerHTML = '';

            updateStatus(`Processing query with ${selectedSearchMode} mode...`, false, false);
            if (rephraseQueryBtn) rephraseQueryBtn.disabled = true;
            if (retrieveContextBtn) retrieveContextBtn.disabled = true;
            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
            if (retrieveContextOriginalBtn) retrieveContextOriginalBtn.disabled = true;
            // Clear step-by-step areas too, as we are running a full pipeline mode
            rephrasedQueryArea.textContent = "";
            retrievedContextArea.textContent = "";
            currentOriginalQuery = query; // Store for potential use

            let messageType = 'query'; // Default for semantic
            let workerPayload: any = {};

            if (selectedSearchMode === 'bm25') {
                messageType = 'bm25Search';
                workerPayload = {
                    query,
                    k1,
                    b,
                    topN,
                    bm25FilterK // Added
                };
            } else if (selectedSearchMode === 'hybrid') {
                messageType = 'hybridSearch';
                workerPayload = {
                    query,
                    k1,
                    b,
                    k_rrf,
                    topN,
                    similarityMetric: currentSimilarityMetric,
                    bm25FilterK, // Added
                    // Hybrid can also have a generative step, so pass generative params
                    systemPrompt: systemPrompt || null,
                    rephrasePromptTemplate: rephraseTemplate, // For potential rephrase within hybrid pipeline
                    finalRagPromptTemplate: finalRagTemplate, // For final answer generation
                    chatEngineType,
                    transformersModelId,
                    transformersOnnxFile,
                    rephraseSettings,
                    answerSettings
                };
            } else { // 'semantic' (Full RAG pipeline)
                messageType = 'QUERY'; // This is the existing full RAG pipeline trigger
                if (!rephraseTemplate.includes('{query}')) {
                    alert("Rephrase prompt template must include '{query}' placeholder for semantic mode.");
                    updateStatus("Error in prompt template.", true, true);
                    return;
                }
                if (!finalRagTemplate.includes('{context}') || !finalRagTemplate.includes('{query}')) {
                    alert("Final RAG prompt template must include '{context}' and '{query}' placeholders for semantic mode.");
                    updateStatus("Error in prompt template.", true, true);
                    return;
                }
                if (chatEngineType === 'transformers' && !transformersModelId) {
                    alert("Please enter a Transformers.js model ID or URL for semantic mode.");
                    updateStatus("Missing Transformers.js model ID.", true, true);
                    return;
                }
                workerPayload = {
                    query,
                    systemPrompt: systemPrompt || null,
                    rephrasePromptTemplate: rephraseTemplate,
                    finalRagPromptTemplate: finalRagTemplate,
                    chatEngineType,
                    transformersModelId,
                    transformersOnnxFile,
                    rephraseSettings,
                    answerSettings,
                    similarityMetric: currentSimilarityMetric
                };
            }

            console.log(`RAG Test Main: Posting message to worker. Type: ${messageType}, Payload:`, workerPayload);
            worker.postMessage({ type: messageType, payload: workerPayload });
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
            if (!isWorkerReady || !worker) {
                updateStatus("Worker not ready. Cannot rephrase query.", true);
                return;
            }
            const queryText = queryInput.value;
            if (!queryText.trim()) {
                updateStatus("Query is empty. Cannot rephrase.", true);
                rephrasedQueryArea.innerHTML = '<p class="text-red-500">Query cannot be empty.</p>';
                return;
            }

            currentOriginalQuery = queryText; // Store original query for later steps

            const strategy = rephraseStrategySelect.value;
            updateStatus(`Rephrasing query using ${strategy} strategy...`);
            rephrasedQueryArea.innerHTML = '<p><i>Rephrasing in progress...</i></p>';
            console.log(`Rephrasing query: "${queryText}" using strategy: ${strategy}`);

            if (strategy === 'rules') { // Changed from 'rule-based' to 'rules' to match HTML option value
                worker.postMessage({
                    type: 'REPHRASE_QUERY_RULE_BASED',
                    query: queryText
                });
            } else { // llm-based (value 'llm') or default
                const rephraseTemperature = parseFloat(rephraseTemperatureSlider.value);
                const rephraseTopP = parseFloat(rephraseTopPSlider.value);
                const rephraseTopK = parseInt(rephraseTopKInput.value, 10);
                const rephraseMaxNewTokens = parseInt(rephraseMaxNewTokensInput.value, 10);

                // Get chat engine config for LLM rephrase
                let chatEngineType = 'webllm'; // Default
                if (chatEngineTransformersJSDefaultRadio.checked) {
                    chatEngineType = 'transformers';
                } else if (chatEnginePleiasRAGRadio.checked) {
                    chatEngineType = 'transformers_pleias';
                } else if (chatEnginePleiasRAG1BRadio.checked) {
                    chatEngineType = 'transformers_pleias_1b';
                }

                let currentTransformersModelId: string | null = null;
                let currentTransformersOnnxFile: string | null = null;

                if (chatEngineType === 'transformers') {
                    currentTransformersModelId = transformersModelInput.value.trim();
                    currentTransformersOnnxFile = transformersOnnxFileInput.value.trim();
                } else if (chatEngineType === 'transformers_pleias') {
                    currentTransformersModelId = 'onnx-community/Pleias-RAG-350M-ONNX';
                    currentTransformersOnnxFile = 'onnx/model_quantized.onnx';
                } else if (chatEngineType === 'transformers_pleias_1b') {
                    currentTransformersModelId = 'onnx-community/Pleias-RAG-1B-ONNX';
                    currentTransformersOnnxFile = 'onnx/model_quantized.onnx';
                }

                const rephraseSettings = {
                    temperature: rephraseTemperature,
                    top_p: rephraseTopP,
                    top_k: rephraseTopK,
                    max_new_tokens: rephraseMaxNewTokens
                };

                worker.postMessage({
                    type: 'REPHRASE_QUERY',
                    payload: {
                        originalQuery: queryText,
                        rephrasePromptTemplate: rephrasePromptTemplateInput.value, // Send the raw template
                        systemPrompt: systemPromptInput.value.trim() || null,
                        chatEngineType: chatEngineType,
                        transformersModelId: currentTransformersModelId,
                        transformersOnnxFile: currentTransformersOnnxFile,
                        rephraseSettings: rephraseSettings
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

            let titleHtml = '';
            if (docTitle !== result.id) {
                titleHtml = `<strong>Title:</strong> ${escapeHtml(docTitle)}<br/>`;
            }

            html += `<li>
                <strong>ID:</strong> ${escapeHtml(result.id)}<br/>
                ${titleHtml}                <strong>Score:</strong> ${result.score.toFixed(4)}<br/>
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

    // --- NEW: Event Listener for Dedicated BM25 Test Button ---
    if (testBm25OnlyBtn) {
        testBm25OnlyBtn.addEventListener('click', () => {
            const query = queryInput.value.trim();
            if (!query) {
                alert("Please enter a query for BM25 testing.");
                return;
            }

            const k1 = parseFloat(bm25K1Input.value);
            const b = parseFloat(bm25BInput.value);
            const topN = parseInt(hybridTopNInput.value, 10);
            const bm25FilterK = parseInt(bm25FilterKmeansKInput.value, 10); // Added

            if (worker && isWorkerReady) {
                dedicatedBm25TestResultsArea.innerHTML = 'Processing BM25 test...';
                updateStatus('Running dedicated BM25 test...', false, false);
                if (submitQueryBtn) submitQueryBtn.disabled = true; // Disable other buttons
                testBm25OnlyBtn.disabled = true;

                worker.postMessage({
                    type: 'DEDICATED_BM25_TEST_REQUEST',
                    payload: {
                        query,
                        k1,
                        b,
                        topN,
                        bm25FilterK // Added
                    }
                });
            } else {
                alert("Worker is not ready. Please wait for initialization.");
            }
        });
    }
    // --- END: New Event Listener ---

    // Function to display performance metrics
    function updatePerformanceMetricsDisplay(metrics: any) {
        const metricsArea = document.getElementById('performanceMetricsArea'); // Get it here, as it might not be in requiredElements yet if created dynamically
        if (!metricsArea) {
            console.error("performanceMetricsArea DOM element not found when trying to update!");
            return;
        }
        console.log("Updating Performance Metrics Display with:", metrics);

        let html = '<h4>Performance Metrics:</h4><ul>';

        // Standard RAG Pipeline Timings
        if (metrics.rephraseTime !== undefined) {
            html += `<li>Rephrase Time: ${metrics.rephraseTime.toFixed(0)} ms</li>`;
        }
        if (metrics.contextRetrievalTime !== undefined) {
            html += `<li>Context Retrieval Time: ${metrics.contextRetrievalTime.toFixed(0)} ms</li>`;
        }

        // Hybrid Search Specific Timings
        if (metrics.bm25Time !== undefined) { // Note: worker sends bm25Time
            html += `<li>BM25 Search Time: ${metrics.bm25Time.toFixed(0)} ms</li>`;
        }
        if (metrics.fusionTime !== undefined) { // Note: worker sends fusionTime
            html += `<li>RRF Fusion Time: ${metrics.fusionTime.toFixed(0)} ms</li>`;
        }

        // Generation Timings (Common)
        if (metrics.generationTime !== undefined) {
            html += `<li>LLM Generation Time: ${metrics.generationTime.toFixed(0)} ms</li>`;
            if (metrics.totalTokens !== undefined && metrics.generationTime > 0 && metrics.tokensPerSecond !== undefined) {
                html += `<li>LLM Output: ${metrics.totalTokens} tokens, ${metrics.tokensPerSecond.toFixed(2)} tk/s</li>`;
            }
        }

        // Total Pipeline Timings
        if (metrics.totalPipelineTime !== undefined) { // From full RAG pipeline (worker sends totalPipelineTime)
            html += `<li>Total Full RAG Pipeline Time: ${metrics.totalPipelineTime.toFixed(0)} ms</li>`;
        }
        if (metrics.totalHybridTime !== undefined) { // From hybrid search pipeline
            html += `<li>Total Hybrid Search Time: ${metrics.totalHybridTime.toFixed(0)} ms</li>`;
        }

        if (metrics.llmEngine) {
            html += `<li>LLM Engine: ${escapeHtml(metrics.llmEngine)}</li>`;
        }

        html += '</ul>';
        metricsArea.innerHTML = html;
        metricsArea.style.display = 'block'; // Make sure it is visible
    }

    // --- NEW: Logic for Rephrase Strategy UI ---
    function toggleLLMSettingsVisibility() {
        if (!rephraseStrategySelect || !llmRephraseSettingsDivForPrompt || !llmRephraseSettingsDivForModel) {
            console.warn("Rephrase strategy UI elements not found, cannot toggle visibility.");
            return;
        }
        const strategy = rephraseStrategySelect.value;
        if (strategy === 'llm') { // Changed from 'llm-based' to 'llm'
            llmRephraseSettingsDivForPrompt.style.display = '';
            llmRephraseSettingsDivForModel.style.display = '';
        } else {
            llmRephraseSettingsDivForPrompt.style.display = 'none';
            llmRephraseSettingsDivForModel.style.display = 'none';
        }
    }

    if (rephraseStrategySelect) {
        rephraseStrategySelect.addEventListener('change', toggleLLMSettingsVisibility);
        // Initialize visibility based on the default selected value
        toggleLLMSettingsVisibility();
    } else {
        console.warn("Rephrase strategy select element not found. LLM settings visibility control will not be active.");
    }
    // --- END: Logic for Rephrase Strategy UI ---

    // Ensure CJS environment is properly set up before attempting to load models that might need it.
    CjsEnv.allowLocalModels = true; // Allow loading local models/quantized models

    // Helper function to update min context score slider attributes and label
    // function updateMinScoreContextAndDisplay() { // REMOVE FUNCTION
    //     if (!minContextScoreValue || !minContextScoreSlider || !similarityMetricSelect) {
    //         // This console warning can be noisy if elements are not always present (e.g. in different test UIs)
    //         // console.warn("Min score UI elements not fully available for updateMinScoreContextAndDisplay.");
    //         return;
    //     }
    //
    //     const metric = similarityMetricSelect.value;
    //     // let currentSliderValueStr = minContextScoreSlider.value; // Read current value
    //     let labelPrefix = "";
    //
    //     if (metric === 'euclidean') {
    //         labelPrefix = "Max Distance: ";
    //         minContextScoreSlider.min = "0";
    //         minContextScoreSlider.max = "2.0"; // Max Euclidean for L2-normed vectors is 2
    //         minContextScoreSlider.step = "0.01";
    //     } else if (metric === 'manhattan') {
    //         labelPrefix = "Max Distance: ";
    //         minContextScoreSlider.min = "0";
    //         // Max for Manhattan is less standard, depends on dimensionality and normalization.
    //         // Using a practical range for typical normalized embeddings.
    //         minContextScoreSlider.max = "10.0";
    //         minContextScoreSlider.step = "0.1";
    //     } else { // Default for cosine, dotproduct, etc.
    //         labelPrefix = "Min Score: ";
    //         minContextScoreSlider.min = "0"; // Assuming effective scores are [0,1] for similarity
    //         minContextScoreSlider.max = "1.0";
    //         minContextScoreSlider.step = "0.01";
    //     }
    //
    //     // Ensure the current value is within the new min/max bounds.
    //     // The browser should clamp .value if it's set outside min/max,
    //     // but parseFloat and re-assigning ensures our logic reflects this.
    //     let numericValue = parseFloat(minContextScoreSlider.value);
    //     const newMin = parseFloat(minContextScoreSlider.min);
    //     const newMax = parseFloat(minContextScoreSlider.max);
    //
    //     if (numericValue < newMin) {
    //         minContextScoreSlider.value = String(newMin);
    //     } else if (numericValue > newMax) {
    //         minContextScoreSlider.value = String(newMax);
    //     }
    //     // If it was within bounds, minContextScoreSlider.value is already correct.
    //     // We ensure it's formatted according to step precision for display.
    //     const stepPrecision = minContextScoreSlider.step.includes('.') ? minContextScoreSlider.step.split('.')[1].length : 0;
    //     const displayValue = parseFloat(minContextScoreSlider.value).toFixed(stepPrecision);
    //
    //     minContextScoreValue.textContent = labelPrefix + displayValue;
    // }

    // Set the RAG embedding model name display ONCE on load
    if (ragEmbeddingModelNameSpan) {
        ragEmbeddingModelNameSpan.textContent = WEBLLM_EMBEDDING_MODEL_ID;
    }

}); 