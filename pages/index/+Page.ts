// pages/index/+Page.ts
// Environment: server/client

import type { PageProps } from './types'
import '../style.css'
import type { PageContext } from 'vike/types'

export { Page }

function Page(pageProps: PageProps) {
    // Return a regular template string instead of using html``
    const contentHtml = `
    <div class="container">
      <p class="description">
        Explore data and policies across California's K-12 school districts.
        Search for a district below to view details, schools, and relevant policy information.
      </p>

      <!-- Disclaimer/Notes Placeholder -->
      <div class="disclaimer" style="font-size: 0.9em; margin: 15px 0; background-color: #f9f9f9; border: 1px solid #eee; padding: 10px;">
          <strong>Disclaimer:</strong> Data is based on publicly available sources from the CDE and other agencies. Policy information is synthesized and may require verification against official documents.
      </div>

      <!-- Search Section -->
      <div class="search-container">
        <label for="district-search-input"><strong>Search for a District:</strong></label>
        <input 
          type="text" 
          id="district-search-input" 
          placeholder="Enter district name..." 
          disabled 
          aria-label="Search for a school district" 
          style="margin-left: 10px; padding: 8px; width: 300px;"
        />
        <div 
          id="district-results" 
          hidden 
          role="listbox" 
          style="border: 1px solid #ccc; margin-top: 5px; max-height: 200px; width: 318px; overflow-y: auto; background-color: white; position: absolute; z-index: 1000;"
        ></div>
      </div>

      <!-- Info Display Area -->
      <div id="info-display">
        <!-- Selected district info will be loaded here by client-side JS -->
      </div>
    </div>
  `
    return contentHtml;
}

// Set default title for the homepage - MOVED to +config.ts
// export const title = 'Unofficial California Education Policies Navigator - Home' 