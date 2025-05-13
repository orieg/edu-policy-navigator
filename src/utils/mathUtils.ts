/**
 * Calculates the cosine similarity between two vectors.
 * Assumes vectors are already L2 normalized if normalization is desired before similarity calculation.
 * @param vecA First vector (Float32Array or number[]).
 * @param vecB Second vector (Float32Array or number[]).
 * @returns Cosine similarity score (dot product if vectors are unit vectors).
 */
export function dotProduct(
    vecA: Float32Array | number[],
    vecB: Float32Array | number[]
): number {
    if (vecA.length !== vecB.length) {
        console.error("Vectors must have the same length for cosine similarity.");
        return 0;
    }
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
    }
    // If vectors are not normalized, you would divide by (magnitude(vecA) * magnitude(vecB))
    // Here, we assume they are (or will be) normalized if that's the requirement for the score.
    return dotProduct;
}

/**
 * Calculates the Manhattan (L1) distance between two vectors.
 * Lower values mean more similarity (closer vectors).
 * @param vecA First vector.
 * @param vecB Second vector.
 * @returns Manhattan distance.
 */
export function manhattanDistance(
    vecA: Float32Array | number[],
    vecB: Float32Array | number[]
): number {
    if (vecA.length !== vecB.length) {
        console.error("Vectors must have the same length for Manhattan distance.");
        return Infinity; // Return a value indicating maximal distance or error
    }
    let distance = 0;
    for (let i = 0; i < vecA.length; i++) {
        distance += Math.abs(vecA[i] - vecB[i]);
    }
    return distance;
}

/**
 * L2 Normalizes a vector.
 * @param vector The vector to normalize.
 * @returns A new Float32Array containing the L2 normalized vector.
 */
export function normalizeL2(vector: Float32Array | number[]): Float32Array {
    let norm = 0;
    for (let i = 0; i < vector.length; i++) {
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return new Float32Array(vector); // Avoid division by zero, return copy of original (or zero vector)

    const normalized = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) {
        normalized[i] = vector[i] / norm;
    }
    return normalized;
}

/**
 * Calculates the L2 norm (Euclidean length) of a vector.
 * @param vec Float32Array
 * @returns The L2 norm.
 */
export function l2Norm(vec: Float32Array): number {
    let sumOfSquares = 0;
    for (let i = 0; i < vec.length; i++) {
        sumOfSquares += vec[i] * vec[i];
    }
    return Math.sqrt(sumOfSquares);
}

/**
 * Normalizes a vector to unit length (L2 normalization).
 * @param vec Float32Array
 * @returns A new Float32Array representing the normalized vector.
 *          Returns a zero vector of the same length if the input vector's norm is 0.
 */
export function normalizeVector(vec: Float32Array): Float32Array {
    const norm = l2Norm(vec);
    if (norm === 0) {
        // Return a zero vector of the same length.
        // Or, could throw an error, depending on desired behavior for zero-length vectors.
        return new Float32Array(vec.length);
    }
    const normalized = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
        normalized[i] = vec[i] / norm;
    }
    return normalized;
}

/**
 * Calculates the cosine similarity between two vectors.
 * Assumes vectors are already L2-normalized if using dot product directly.
 * If not normalized, this function should ideally normalize them first or use
 * the formula: dot(A, B) / (norm(A) * norm(B)).
 * For simplicity here, assuming they are or will be normalized before if needed.
 * @param vecA Float32Array
 * @param vecB Float32Array
 * @returns The cosine similarity.
 */
export function cosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    // For L2-normalized vectors, dot product is cosine similarity.
    // If vectors might not be normalized, true cosine similarity is:
    // return dotProduct(vecA, vecB) / (l2Norm(vecA) * l2Norm(vecB));
    // However, our embedding generation typically outputs normalized vectors.
    return dotProduct(vecA, vecB);
}

/**
 * Calculates the Euclidean distance (L2 distance) between two vectors.
 * @param vecA Float32Array
 * @param vecB Float32Array
 * @returns The Euclidean distance.
 */
export function euclideanDistance(vecA: Float32Array, vecB: Float32Array): number {
    if (vecA.length !== vecB.length) {
        throw new Error("Vectors must have the same dimensionality for Euclidean distance.");
    }
    let sumOfSquaredDifferences = 0;
    for (let i = 0; i < vecA.length; i++) {
        sumOfSquaredDifferences += (vecA[i] - vecB[i]) ** 2;
    }
    return Math.sqrt(sumOfSquaredDifferences);
}

/**
 * General purpose similarity/distance calculation.
 * @param vecA Float32Array query vector
 * @param vecB Float32Array document vector
 * @param metric 'cosine', 'dot_product', 'manhattan', or 'euclidean'
 * @returns The calculated score. Higher is better for 'cosine' and 'dot_product', lower is better for 'manhattan' and 'euclidean'.
 */
export function calculateSimilarity(vecA: Float32Array, vecB: Float32Array, metric: string): number {
    switch (metric.toLowerCase()) {
        case 'cosine':
            // Assuming vectors are normalized for 'cosine' when dot product is used.
            // If not, proper normalization should happen before this call or inside cosineSimilarity.
            return cosineSimilarity(vecA, vecB);
        case 'dot_product':
            return dotProduct(vecA, vecB);
        case 'manhattan':
            return manhattanDistance(vecA, vecB);
        case 'euclidean':
            return euclideanDistance(vecA, vecB);
        default:
            console.warn(`Unknown similarity metric: ${metric}. Defaulting to cosine similarity.`);
            return cosineSimilarity(vecA, vecB);
    }
}

// Example Usage (can be removed or kept for testing)
/*
const vectorA = new Float32Array([1, 2, 3]);
const vectorB = new Float32Array([4, 5, 6]);
const normalizedA = normalizeVector(vectorA);
const normalizedB = normalizeVector(vectorB);

console.log("Vector A:", vectorA);
console.log("Vector B:", vectorB);
console.log("Normalized A:", normalizedA);
console.log("Normalized B:", normalizedB);

console.log("Dot Product (Original):", dotProduct(vectorA, vectorB));
console.log("Dot Product (Normalized, Cosine Sim):", dotProduct(normalizedA, normalizedB));
console.log("Cosine Similarity (via calculateSimilarity):", calculateSimilarity(normalizedA, normalizedB, 'cosine'));
console.log("Dot Product (via calculateSimilarity):", calculateSimilarity(vectorA, vectorB, 'dot_product'));
console.log("Manhattan Distance (via calculateSimilarity):", calculateSimilarity(vectorA, vectorB, 'manhattan'));
console.log("Euclidean Distance (via calculateSimilarity):", calculateSimilarity(vectorA, vectorB, 'euclidean'));

const vectorC = new Float32Array([0.1, 0.2, 0.3, 0.4]);
const vectorD = new Float32Array([0.5, 0.1, 0.2, 0.8]);
const normalizedC = normalizeVector(vectorC);
const normalizedD = normalizeVector(vectorD);

console.log("Norm C:", l2Norm(vectorC));
console.log("Norm D:", l2Norm(vectorD));
console.log("Normalized C:", normalizedC);
console.log("Normalized D:", normalizedD);
console.log("Cosine (norm C, norm D):", calculateSimilarity(normalizedC, normalizedD, 'cosine'));
console.log("Dot (C, D):", calculateSimilarity(vectorC, vectorD, 'dot_product'));
console.log("Manhattan (C,D):", calculateSimilarity(vectorC, vectorD, 'manhattan'));
console.log("Euclidean (C,D):", calculateSimilarity(vectorC, vectorD, 'euclidean'));

const nearVector1 = new Float32Array([1.0, 0.0, 0.0]);
const nearVector2 = new Float32Array([0.9, 0.1, 0.0]); // Close to nearVector1
const farVector = new Float32Array([-1.0, 0.0, 0.0]); // Opposite to nearVector1

console.log("--- Test cases for sorting ---");
console.log("Near1 vs Near2 (Cosine):", calculateSimilarity(nearVector1, nearVector2, 'cosine')); // Expect close to 1
console.log("Near1 vs Far (Cosine):", calculateSimilarity(nearVector1, farVector, 'cosine'));   // Expect close to -1
console.log("Near1 vs Near2 (Dot Product):", calculateSimilarity(nearVector1, nearVector2, 'dot_product')); // Expect close to 0.9
console.log("Near1 vs Far (Dot Product):", calculateSimilarity(nearVector1, farVector, 'dot_product'));   // Expect close to -0.9
console.log("Near1 vs Near2 (Manhattan):", calculateSimilarity(nearVector1, nearVector2, 'manhattan')); // Expect small positive
console.log("Near1 vs Far (Manhattan):", calculateSimilarity(nearVector1, farVector, 'manhattan'));   // Expect larger positive
console.log("Near1 vs Near2 (Euclidean):", calculateSimilarity(nearVector1, nearVector2, 'euclidean')); // Expect small positive
console.log("Near1 vs Far (Euclidean):", calculateSimilarity(nearVector1, farVector, 'euclidean'));   // Expect larger positive

*/ 