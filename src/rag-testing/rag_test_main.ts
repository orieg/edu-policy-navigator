console.log("RAG Test Main: Script loaded.");

// Import the worker using Vite's ?worker syntax
import RagWorker from '/src/rag-testing/rag_worker.ts?worker';
// Dynamically import transformers.js for in-browser use
import { pipeline, env as CjsEnv } from '@xenova/transformers';

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

    // Chat model config UI
    const temperatureSlider = document.getElementById('temperatureSlider') as HTMLInputElement;
    const temperatureValueSpan = document.getElementById('temperatureValue') as HTMLSpanElement;

    let worker: Worker | undefined;
    let inBrowserExtractor: any = null; // For in-browser transformers.js pipeline

    // Intermediate state for step-by-step RAG
    let currentRephrasedQuery: string | null = null;
    let currentRetrievedContext: string | null = null;
    let currentOriginalQuery: string | null = null;

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

    // Update temperature display on slider input
    if (temperatureSlider && temperatureValueSpan) {
        temperatureSlider.addEventListener('input', () => {
            temperatureValueSpan.textContent = temperatureSlider.value;
        });
        // Set initial display value
        temperatureValueSpan.textContent = temperatureSlider.value;
    }

    // Set default prompt template values
    if (rephrasePromptTemplateInput) {
        rephrasePromptTemplateInput.value = `**Objective:** Transform the User Query into a concise, factual query that will have high semantic similarity with records in our school database when used for RAG retrieval (vector cosine similarity).

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
Return * only * the rephrased, optimized query.Do not include any explanations, labels, or introductory text.

User Query: { query } `;
    }
    if (finalRagPromptTemplateInput) {
        finalRagPromptTemplateInput.value = "Context:\n{context}\n\nQuestion: {query}\n\nAnswer:";
    }

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
            if (temperatureSlider) temperatureSlider.disabled = !isReady;
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
                quantized: false, // Match node.js validation setting
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
                console.log("RAG Test Main: Message received from worker:", event.data);
                const { type, payload } = event.data;

                switch (type) {
                    case 'status':
                        updateStatus(payload.message, payload.isError, payload.isReady);
                        break;
                    case 'progress':
                        updateProgress(payload.message, payload.loaded, payload.total);
                        break;
                    case 'response':
                        if (payload.error) {
                            responseArea.textContent = `Error: ${payload.error}`;
                            responseArea.style.color = 'red';
                        } else {
                            responseArea.textContent = payload.result;
                            responseArea.style.color = '#333';
                        }
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
                        if (payload) {
                            currentRephrasedQuery = payload.rephrasedQuery || null;
                            rephrasedQueryArea.textContent = currentRephrasedQuery || 'No rephrased query returned.';
                            if (payload.error) {
                                rephrasedQueryArea.style.color = 'red';
                                rephrasedQueryArea.textContent = `Error: ${payload.error}`;
                                updateStatus(`Error rephrasing query: ${payload.error}`, true, true);
                                if (retrieveContextBtn) retrieveContextBtn.disabled = true;
                            } else {
                                rephrasedQueryArea.style.color = '#333';
                                updateStatus('Query rephrased. Ready for next step.', false, true);
                                if (retrieveContextBtn) retrieveContextBtn.disabled = !currentRephrasedQuery;
                            }
                            if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
                            currentRetrievedContext = null;
                            retrievedContextArea.textContent = "";
                        }
                        break;
                    case 'RETRIEVED_CONTEXT_RESULT':
                        if (payload) {
                            currentRetrievedContext = payload.context || null;
                            let contextDisplay = "No context retrieved.";
                            if (currentRetrievedContext) {
                                if (Array.isArray(currentRetrievedContext)) {
                                    contextDisplay = currentRetrievedContext.join('\\n---\\n');
                                } else {
                                    contextDisplay = currentRetrievedContext;
                                }
                            }
                            retrievedContextArea.textContent = contextDisplay;

                            if (payload.error) {
                                retrievedContextArea.style.color = 'red';
                                retrievedContextArea.textContent = `Error: ${payload.error}`;
                                updateStatus(`Error retrieving context: ${payload.error}`, true, true);
                                if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
                            } else {
                                retrievedContextArea.style.color = '#333';
                                updateStatus('Context retrieved. Ready for final answer generation.', false, true);
                                if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = !currentRetrievedContext;
                            }
                        }
                        break;
                    case 'FINAL_ANSWER_RESULT':
                        if (payload) {
                            responseArea.textContent = payload.finalAnswer || 'No final answer text.';
                            responseArea.style.color = payload.error ? 'red' : '#333';
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
        const temperature = parseFloat(temperatureSlider.value); // Get temperature

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
                type: 'query', // This is the full RAG pipeline
                payload: {
                    query,
                    systemPrompt: systemPrompt || null,
                    rephrasePromptTemplate: rephraseTemplate,
                    finalRagPromptTemplate: finalRagTemplate,
                    temperature // Pass temperature
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
            const temperature = parseFloat(temperatureSlider.value); // Get temperature

            if (!originalQuery) {
                alert("Please enter an original query.");
                return;
            }
            if (!rephraseTemplate.includes('{query}')) {
                alert("Rephrase prompt template must include '{query}' placeholder.");
                return;
            }
            if (worker) {
                currentOriginalQuery = originalQuery; // Store original query
                updateStatus('Rephrasing query...', false, false);
                if (retrieveContextBtn) retrieveContextBtn.disabled = true;
                if (generateFinalAnswerBtn) generateFinalAnswerBtn.disabled = true;
                rephrasedQueryArea.textContent = 'Rephrasing...';
                retrievedContextArea.textContent = ''; // Clear old context

                worker.postMessage({
                    type: 'REPHRASE_QUERY',
                    payload: {
                        originalQuery,
                        rephrasePromptTemplate: rephraseTemplate,
                        systemPrompt: systemPrompt || null,
                        temperature // Pass temperature
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
            const temperature = parseFloat(temperatureSlider.value); // Get temperature

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

            if (worker) {
                responseArea.textContent = 'Generating final answer...';
                responseArea.style.color = '#555';
                updateStatus('Generating final answer...', false, false);

                worker.postMessage({
                    type: 'GENERATE_FINAL_ANSWER',
                    payload: {
                        originalQuery: finalQuery,
                        context,
                        finalRagPromptTemplate: finalRagTemplate,
                        systemPrompt: systemPrompt || null,
                        temperature // Pass temperature
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