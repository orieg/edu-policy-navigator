# Guide: Converting Snowflake/snowflake-arctic-embed-xs to MLC-LLM Format

This guide outlines the steps to convert the `Snowflake/snowflake-arctic-embed-xs` HuggingFace model to the MLC-LLM format, suitable for use with WebLLM and for hosting on your HuggingFace account (`orieg`).

**Model to Convert:** `Snowflake/snowflake-arctic-embed-xs`
**Target HF Account for Hosting:** `orieg`
**Assumed New Model Name on HF:** `orieg/snowflake-arctic-embed-xs-mlc` (You can choose a different name)

## Prerequisites

1.  **MLC-LLM and TVM Unity Installation:**
    *   Ensure you have `mlc_llm` Python package installed and working.
        ```bash
        mlc_llm --help 
        # or python -m mlc_llm --help
        ```
    *   Ensure Apache TVM (Unity) is installed and accessible in your Python environment. This is a backend for `mlc_llm`.
        ```bash
        python -c "import tvm; print(tvm.__file__)"
        ```
    *   Refer to the official MLC-LLM documentation for detailed installation instructions:
        *   [Install TVM Unity Compiler](https://llm.mlc.ai/docs/dependency_installation/install_tvm_unity_compiler.html)
        *   [Install MLC LLM Python Package](https://llm.mlc.ai/docs/dependency_installation/install_mlc_llm_python_package.html)

2.  **Git LFS:**
    *   Ensure Git LFS is installed: `git lfs install`

3.  **HuggingFace Hub CLI (Optional, for easy uploading):**
    *   `pip install huggingface_hub`
    *   Login to HuggingFace: `huggingface-cli login`

## Conversion Steps

Let\'s assume you are working in a directory where `mlc-llm` repository is cloned or your project has access to its scripts. The commands below create a `dist` directory for outputs.

### Step 1: Clone the Original HuggingFace Model

This will download the `Snowflake/snowflake-arctic-embed-xs` model files, including the ONNX model and tokenizer configurations.

```bash
# Create a working directory for the original model files
mkdir -p dist/models/Snowflake-snowflake-arctic-embed-xs-original
cd dist/models/Snowflake-snowflake-arctic-embed-xs-original

# Clone the model (it\'s small, so full clone is fine)
git init
git remote add origin https://huggingface.co/Snowflake/snowflake-arctic-embed-xs
git pull origin main # Or the specific commit/branch you want

# Go back to your main working directory (e.g., where dist is)
cd ../../.. 
# (Adjust path as needed, you should now be in the directory containing \'dist\')
```

### Step 2: Convert Model Weights and Quantize

This step converts the model weights into MLC format and applies quantization. We\'ll use `q4f16_1` as a common balanced quantization. You can experiment with others like `q0f16` (for float16) if needed.

Let `MODEL_NAME_MLC="snowflake-arctic-embed-xs-q4f16_1-mlc"` (or your preferred name indicating quantization).
Let `OUTPUT_DIR="dist/${MODEL_NAME_MLC}"`
Let `ORIGINAL_MODEL_DIR="dist/models/Snowflake-snowflake-arctic-embed-xs-original"`

```bash
# Define variables for paths (makes it easier)
ORIGINAL_MODEL_DIR="dist/models/Snowflake-snowflake-arctic-embed-xs-original"
QUANTIZATION_MODE="q4f16_1" # Or "q0f16", "q8f16_0", etc.
MODEL_NAME_BASE="snowflake-arctic-embed-xs" # Base name for the output
OUTPUT_DIR="dist/${MODEL_NAME_BASE}-${QUANTIZATION_MODE}-mlc"

# Create output directory
mkdir -p "${OUTPUT_DIR}"

echo "Converting weights from: ${ORIGINAL_MODEL_DIR}"
echo "Outputting to: ${OUTPUT_DIR}"
echo "Using quantization: ${QUANTIZATION_MODE}"

mlc_llm convert_weight "${ORIGINAL_MODEL_DIR}" \
    --quantization "${QUANTIZATION_MODE}" \
    -o "${OUTPUT_DIR}"

echo "Weight conversion complete. Check ${OUTPUT_DIR} for ndarray-cache.json and params_shard_*.bin files."
```
*   **Note on ONNX input:** `mlc_llm convert_weight` primarily works with PyTorch models by default. Since `Snowflake/snowflake-arctic-embed-xs` provides ONNX files, ensure your `mlc_llm` version and TVM can correctly process these, or check if specific flags are needed for ONNX inputs. Often, if the directory contains ONNX and a `config.json` understood by HuggingFace `AutoModel`, it might work. If direct conversion from the HF directory fails, you might need a preliminary step to load the ONNX model explicitly in a Python script and then pass it to MLC\'s conversion utilities. However, try the direct path first.

### Step 3: Generate MLC Chat Config and Process Tokenizer

This creates the `mlc-chat-config.json` and copies/processes tokenizer files.

```bash
# Variables from Step 2 are assumed to be set (ORIGINAL_MODEL_DIR, QUANTIZATION_MODE, OUTPUT_DIR)

echo "Generating MLC config for: ${ORIGINAL_MODEL_DIR}"
echo "Outputting to: ${OUTPUT_DIR}"

# For embedding models, a specific conv_template isn\'t strictly necessary for its core function,
# but mlc-chat-config.json requires one. "LM" or a basic one might suffice, or you might need to use "custom".
# If this causes issues, you might need to create a dummy conversation template or find a generic one.
# For now, let\'s try omitting it or using a common default if the tool allows.
# If --conv-template is mandatory and no default works, you might need `custom` and ensure
# the relevant sections in mlc-chat-config.json are minimal or placeholder for an embedding model.
# Let\'s try with a common one like "llama-2" first, as it\'s well-supported, though not directly applicable.
# The tool should primarily focus on model architecture and tokenizer data for embedding models.
CONV_TEMPLATE="llama-2" # This is a placeholder; ideally, find one suitable for "no chat" or "LM"

mlc_llm gen_config "${ORIGINAL_MODEL_DIR}" \
    --quantization "${QUANTIZATION_MODE}" \
    --conv-template "${CONV_TEMPLATE}" \
    -o "${OUTPUT_DIR}"

echo "MLC config generation complete. Check ${OUTPUT_DIR} for mlc-chat-config.json and tokenizer files."
```
*   **Conversation Template:** The `--conv-template` is tricky for embedding models. The primary goal of `gen_config` here is to populate `mlc-chat-config.json` with the correct model architecture details (from the original `config.json`) and paths to tokenizer files. If `llama-2` causes issues or isn\'t appropriate, you might need to check MLC-LLM documentation for how to handle non-chat models or use `--conv-template custom` and manually ensure the `mlc-chat-config.json` is sensible.

### Step 4: Compile the Model Library (WASM)

This is a crucial step that was separate from the "Convert Model Weights" documentation. This compiles the model architecture (defined by `mlc-chat-config.json`) into a WASM library for the browser.

```bash
# Variables from Step 2 are assumed to be set (OUTPUT_DIR, QUANTIZATION_MODE, MODEL_NAME_BASE)
# The mlc-chat-config.json inside OUTPUT_DIR is used here.

echo "Compiling model library for ${OUTPUT_DIR}"

# The exact command for mlc_llm compile can vary.
# It usually takes the config (which implies the model architecture and quantization)
# and a target. For WebLLM, the target is often webgpu.
# The output is a .wasm file.

# Example: mlc_llm compile <path_to_mlc_chat_config.json_or_model_dir_containing_it> --target wasm -o <output_wasm_name>.wasm
# The output name often follows the pattern: <model_name_with_quantization>-webllm.wasm

WASM_OUTPUT_NAME="${MODEL_NAME_BASE}-${QUANTIZATION_MODE}-webllm.wasm"

# Note: Ensure the model ID used here or the path correctly points to your generated mlc-chat-config.json
# and the previously converted weights within OUTPUT_DIR.
# The `compile` command needs to know the model architecture (from mlc-chat-config)
# and the quantization.
# Often, just pointing to the directory created in step 2 & 3 is enough if it contains mlc-chat-config.json
mlc_llm compile "${OUTPUT_DIR}" \
    --target wasm \
    -o "${OUTPUT_DIR}/${WASM_OUTPUT_NAME}"

# For WebGPU target (often preferred for performance if available):
# mlc_llm compile "${OUTPUT_DIR}" \
#    --target webgpu \
#    -o "${OUTPUT_DIR}/${MODEL_NAME_BASE}-${QUANTIZATION_MODE}-webllm.wasm"


echo "Model library compilation complete. Check ${OUTPUT_DIR} for ${WASM_OUTPUT_NAME}"
```
*   **Target:** Use `--target wasm` for CPU-based WebAssembly, or `--target webgpu` if you intend to use WebGPU (generally faster if supported by the browser/device). The output WASM file should be placed in your `${OUTPUT_DIR}`.
*   Consult the "Compile Model Libraries" section of the MLC LLM docs for the precise syntax of `mlc_llm compile`.

### Step 5: Verify Output Files

After all steps, your `${OUTPUT_DIR}` should contain at least:
*   `mlc-chat-config.json`
*   `ndarray-cache.json`
*   `params_shard_0.bin` (and possibly more shards)
*   `tokenizer.json` (and other tokenizer files like `tokenizer_config.json`, `vocab.txt`)
*   `${MODEL_NAME_BASE}-${QUANTIZATION_MODE}-webllm.wasm` (e.g., `snowflake-arctic-embed-xs-q4f16_1-webllm.wasm`)

### Step 6: Upload to HuggingFace (`orieg` account)

1.  **Create a new model repository on HuggingFace:**
    *   Go to [https://huggingface.co/new](https://huggingface.co/new)
    *   Owner: `orieg`
    *   Model name: e.g., `snowflake-arctic-embed-xs-mlc` (or whatever you decided)
    *   Choose "Public" or "Private".
    *   Create model.

2.  **Clone the new empty repository:**
    ```bash
    # Replace with your actual new model name
    HF_MODEL_REPO_NAME="snowflake-arctic-embed-xs-mlc" 
    git clone "https://huggingface.co/orieg/${HF_MODEL_REPO_NAME}"
    cd "${HF_MODEL_REPO_NAME}"
    ```

3.  **Copy compiled files into the repository:**
    ```bash
    # Assuming you are inside the cloned HF_MODEL_REPO_NAME directory
    # And your OUTPUT_DIR from previous steps is, e.g., ../dist/snowflake-arctic-embed-xs-q4f16_1-mlc/
    cp -r ../${OUTPUT_DIR}/* . 
    # (Adjust relative path ../${OUTPUT_DIR}/* as needed)
    ```

4.  **Commit and Push:**
    ```bash
    git lfs track "*.bin" # If not already tracked by default for .bin files
    git add .
    git commit -m "Add ${MODEL_NAME_BASE} ${QUANTIZATION_MODE} MLC compiled model"
    git push origin main
    ```

### Step 7: Update Your Application

*   In your `edu-policy-navigator`\'s `src/siteConfig.ts`, change `WEBLLM_EMBEDDING_MODEL_ID` to your new HuggingFace model ID:
    ```typescript
    export const WEBLLM_EMBEDDING_MODEL_ID = "orieg/snowflake-arctic-embed-xs-mlc"; // Or your chosen name
    ```
*   Ensure the `WebLLMService.ts` uses the standard MLC model loading logic (the `else` block in our current conditional logic) for this new model ID. It should now find `mlc-chat-config.json` and the specific WASM at the new HF URL.

## Important Notes & Troubleshooting

*   **MLC-LLM Version:** Ensure you are using a recent and compatible version of `mlc_llm` and TVM.
*   **Model Architecture Support:** `Snowflake/snowflake-arctic-embed-xs` is based on `all-MiniLM-L6-v2`. Check if this architecture (BERT-like encoder) is well-supported by the MLC-LLM compilation scripts. You might need to specify the model architecture explicitly if `gen_config` or `compile` cannot infer it correctly.
*   **Tokenizer:** The `gen_config` step should handle the tokenizer. If you face issues, ensure all necessary tokenizer files (`tokenizer.json`, `vocab.txt`, `special_tokens_map.json`, `tokenizer_config.json`) are present in the `${ORIGINAL_MODEL_DIR}`.
*   **Embedding vs. Chat:** The MLC tools are heavily geared towards LLMs for chat. Adapting them for embedding models might require ignoring or providing dummy values for chat-specific configurations (like conversation templates). The core need is correct structural parameters in `mlc-chat-config.json` and a correctly compiled WASM.
*   **Error Messages:** Pay close attention to any error messages during the `convert_weight`, `gen_config`, and `compile` steps. They often provide clues about missing files, unsupported configurations, or issues with the model structure.
*   **Documentation:** Always refer to the latest official MLC LLM documentation for the most up-to-date commands and options.

This comprehensive guide should help you through the process. It involves several steps and might require some experimentation, especially around the `gen_config` and `compile` stages for an embedding model. 