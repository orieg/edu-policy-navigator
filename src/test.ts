import { pipeline, env } from '@huggingface/transformers';

async function runNodeTextGenerationTest() {
  console.log('Starting Node.js text generation test...');

  try {
    // Configure environment
    env.allowLocalModels = false;
    env.useBrowserCache = false; // Not relevant for Node.js but good to be explicit

    const modelName = 'HuggingFaceTB/SmolLM2-135M-Instruct';
    console.log(`Loading text-generation pipeline with model: ${modelName}...`);

    // Create the pipeline
    // Omitting dtype for now to test the most basic successful case
    const generator = await pipeline('text-generation', modelName, {
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
        console.log(statusText);
      }
    });

    console.log('Pipeline loaded. Generating text...');
    const inputText = "Hello, I'm a language model,";
    const result = await generator(inputText, { max_new_tokens: 30 });

    console.log('Generation complete!');
    if (Array.isArray(result) && result.length > 0) {
      const firstResult = result[0];
      if (typeof firstResult === 'object' && firstResult !== null && 'generated_text' in firstResult && typeof firstResult.generated_text === 'string') {
        console.log('Generated Text:', firstResult.generated_text);
      } else {
        console.log('Unexpected array result item format.');
      }
      console.log('\nFull result object:\n', JSON.stringify(result, null, 2));
    } else if (typeof result === 'object' && result !== null && 'generated_text' in result && typeof result.generated_text === 'string') {
      console.log('Generated Text:', result.generated_text);
      console.log('\nFull result object:\n', JSON.stringify(result, null, 2));
    } else {
      console.log('Unexpected result format:', JSON.stringify(result, null, 2));
    }

  } catch (error) {
    console.error('\nNode.js text generation test failed:');
    if (error instanceof Error) {
      console.error('Error Message:', error.message);
      console.error('Error Stack:', error.stack);
    } else {
      console.error('Unknown Error:', error);
    }
  }
}

runNodeTextGenerationTest();
