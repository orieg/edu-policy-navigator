console.log("RAG Test Main: Script loaded.");

document.addEventListener('DOMContentLoaded', () => {
    const queryInput = document.getElementById('queryInput') as HTMLTextAreaElement;
    const submitQueryBtn = document.getElementById('submitQueryBtn') as HTMLButtonElement;
    const responseArea = document.getElementById('responseArea') as HTMLDivElement;
    const statusLabel = document.getElementById('statusLabel') as HTMLDivElement;
    const progressBarContainer = document.getElementById('progressBarContainer') as HTMLDivElement;
    const progressBar = document.getElementById('progressBar') as HTMLDivElement;

    let worker: Worker | undefined;

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

    function initializeWorker() {
        // Access via casting instead of augmenting global scope
        const existingWorker = (window as any).ragWorker;
        if (existingWorker) {
            console.log("RAG Test Main: Worker already exists. Terminating old one.");
            existingWorker.terminate();
            (window as any).ragWorker = undefined;
        }

        console.log("RAG Test Main: Creating Web Worker...");
        try {
            // Ensure this path points to the compiled JS file for the worker
            // Astro will handle the '.ts' to '.js' mapping for the worker import.
            worker = new Worker(new URL('./rag_worker.ts', import.meta.url), { type: 'module' });
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