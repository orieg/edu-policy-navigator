import { pipeline, env } from '@huggingface/transformers';

const runTestBtn = document.getElementById('runTestBtn') as HTMLButtonElement;
const outputDiv = document.getElementById('output') as HTMLDivElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

async function runPipelineTest() {
    if (!runTestBtn || !outputDiv || !statusDiv) {
        console.error('UI elements not found');
        statusDiv.textContent = 'Error: UI elements not found. Check console.';
        return;
    }

    runTestBtn.disabled = true;
    statusDiv.textContent = 'Initializing... Please ensure browser cache was cleared if issues arise.';
    outputDiv.textContent = '';

    try {
        // Critical: Set before any pipeline or model loading
        env.allowLocalModels = false;
        // Optional: enable/disable browser cache for transformers.js
        env.useBrowserCache = true; // Default is true, explicitly setting

        statusDiv.textContent = 'Loading model with pipeline...';

        const generator = await pipeline('text-generation', 'HuggingFaceTB/SmolLM2-135M-Instruct', {
            // dtype: 'q4', // REMOVED: No dtype for initial CPU test
            device: "webgpu", // ADDED BACK: Test with WebGPU
            progress_callback: (progress: any) => {
                let statusText = `Loading: ${progress.status}`;
                if (progress.file) {
                    statusText += ` - ${progress.file.substring(progress.file.lastIndexOf('/') + 1)}`;
                }
                if (progress.loaded && progress.total) {
                    statusText += ` (${Math.round((progress.loaded / progress.total) * 100)}%)`;
                } else if (progress.progress) {
                    statusText += ` (${Math.round(progress.progress)}%)`;
                }
                statusDiv.textContent = statusText;
                console.log('Progress:', progress);
            }
        });

        statusDiv.textContent = 'Model loaded. Generating text...';
        const inputText = "Hello, I'm a language model,";
        const result = await generator(inputText, { max_new_tokens: 30 });

        statusDiv.textContent = 'Generation complete!';
        // The result from a text-generation pipeline is typically an array of objects,
        // or a single object if a single string was passed and no batching occurred implicitly.
        // We will check for the most common array case first.
        if (Array.isArray(result) && result.length > 0) {
            const firstResult = result[0]; // This could be TextGenerationSingle or TextGenerationOutput
            if (typeof firstResult === 'object' && firstResult !== null && 'generated_text' in firstResult && typeof firstResult.generated_text === 'string') {
                // Case: result is TextGenerationSingle[] e.g. [{ generated_text: "..." }]
                outputDiv.textContent = firstResult.generated_text;
            } else if (Array.isArray(firstResult) && firstResult.length > 0 && typeof firstResult[0] === 'object' && firstResult[0] !== null && 'generated_text' in firstResult[0] && typeof firstResult[0].generated_text === 'string') {
                // Case: result is TextGenerationOutput[] which is TextGenerationSingle[][] e.g. [[{ generated_text: "..." }]] (less common for single input)
                outputDiv.textContent = firstResult[0].generated_text;
            } else {
                outputDiv.textContent = `Unexpected array result item format.`;
            }
            outputDiv.textContent += "\n\nFull result object:\n" + JSON.stringify(result, null, 2);
        } else if (typeof result === 'object' && result !== null && 'generated_text' in result && typeof result.generated_text === 'string') {
            // Case: result is a single TextGenerationSingle object (less common for pipeline, but possible)
            outputDiv.textContent = result.generated_text;
            outputDiv.textContent += "\n\nFull result object:\n" + JSON.stringify(result, null, 2);
        } else {
            outputDiv.textContent = `Unexpected result format: ${JSON.stringify(result, null, 2)}`;
        }

    } catch (error) {
        console.error('Pipeline test failed:', error);
        statusDiv.textContent = 'Test failed! Check console for details.';
        outputDiv.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
        if (error instanceof Error && error.stack) {
            outputDiv.textContent += "\n\nStack:\n" + error.stack;
        }
    } finally {
        runTestBtn.disabled = false;
    }
}

if (runTestBtn) {
    runTestBtn.addEventListener('click', runPipelineTest);
} else {
    console.error('Run Test button not found on page load.');
    if (statusDiv) statusDiv.textContent = 'Error: Run Test button not found.';
}

// Initial message
if (statusDiv) {
    statusDiv.textContent = "Ready to test. Important: Clear browser cache (IndexedDB, Cache Storage for this site) if you've had prior issues with Transformers.js.";
} 