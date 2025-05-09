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
    const submitQueryBtn = document.getElementById('submitQueryBtn') as HTMLButtonElement;
    const responseArea = document.getElementById('responseArea') as HTMLDivElement;
    const statusLabel = document.getElementById('statusLabel') as HTMLDivElement;
    const progressBarContainer = document.getElementById('progressBarContainer') as HTMLDivElement;
    const progressBar = document.getElementById('progressBar') as HTMLDivElement;

    // New UI elements for similarity test
    const runSimilarityTestBtn = document.getElementById('runSimilarityTestBtn') as HTMLButtonElement;
    const similarityResultsArea = document.getElementById('similarityResultsArea') as HTMLDivElement;

    let worker: Worker | undefined;
    let inBrowserExtractor: any = null; // For in-browser transformers.js pipeline

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

    function updateStatus(message: string, isError: boolean = false, isReady?: boolean) {
        statusLabel.textContent = message;
        statusLabel.style.color = isError ? 'red' : '#555';
        if (isReady !== undefined) {
            submitQueryBtn.disabled = !isReady;
            queryInput.disabled = !isReady;
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
        if (!query) {
            alert("Please enter a query.");
            return;
        }
        if (worker) {
            responseArea.textContent = 'Processing...';
            responseArea.style.color = '#555';
            updateStatus('Sending query to RAG system...', false, false); // Disable button while processing
            worker.postMessage({ type: 'query', payload: { query } });
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

    // Clean up worker when page is about to be unloaded
    window.addEventListener('beforeunload', () => {
        if ((window as any).ragWorker) {
            console.log("RAG Test Main: Page unloading. Requesting worker to dispose engines.");
            (window as any).ragWorker.postMessage({ type: 'dispose' });
        }
    });

    // Initialize the worker on page load
    initializeWorker();
}); 