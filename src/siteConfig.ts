import type { SiteConfig } from "./scripts/types";

export const SITE_CONFIG: SiteConfig = {
    title: "Multi-District Policy Navigator",
    description: "An experimental tool to navigate and compare school district policies using AI.",
    url: "https://edu-policy-navigator.vercel.app", // TODO: Update with actual deployment URL
    logo: "/logo.svg",
    lastUpdated: new Date(), // TODO: Update dynamically?
    githubUrl: "https://github.com/nielsbom/edu-policy-navigator",
};

// Configuration for the RAG system
export const WEBLLM_CHAT_MODEL_ID = "SmolLM2-135M-Instruct-q0f16-MLC";
export const WEBLLM_EMBEDDING_MODEL_ID = "Snowflake/snowflake-arctic-embed-xs";

// Add other site-wide constants here if needed 