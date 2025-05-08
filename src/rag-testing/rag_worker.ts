console.log("RAG Worker: Minimal script loaded.");

self.onmessage = async (event: MessageEvent) => {
    console.log("RAG Worker (Minimal): Message received from main thread:", event.data);
    const { type } = event.data;

    if (type === 'initialize') {
        console.log("RAG Worker (Minimal): Initialize message received.");
        self.postMessage({
            type: 'status',
            payload: { message: 'Minimal worker initialized successfully.', isError: false, isReady: true }
        });
    } else {
        console.warn("RAG Worker (Minimal): Unknown message type received:", type);
        self.postMessage({ type: 'error', payload: { message: `Unknown command: ${type}` } });
    }
};

console.log("RAG Worker (Minimal): Event listener attached.");
// Send an initial status message to indicate the script itself has loaded and attached the listener
self.postMessage({ type: 'status', payload: { message: 'Minimal worker script ready for commands.', isError: false, isReady: false } }); 