// renderer/+onRenderHtml.ts
// Environment: server

import { dangerouslySkipEscape, escapeInject } from 'vike/server'
import type { OnRenderHtmlAsync } from 'vike/types'

// Define expected shape of pageProps if available
// This might need refinement based on +onBeforeRender return values
interface PageProps {
    description?: string;
    // Add other expected props, e.g., district, schools
}

const onRenderHtml: OnRenderHtmlAsync = async (pageContext):
    ReturnType<OnRenderHtmlAsync> => {
    // Type assertion for pageContext to include custom props
    // const { Page, title, exports } = pageContext
    // const pageProps = pageContext.pageProps as PageProps | undefined
    // Use destructured props directly now type is extended
    const { Page, pageProps, title, exports } = pageContext

    // Get description from pageProps, fallback if needed
    const description = pageProps?.description || 'Unofficial California Education Policy Navigator: Explore district data.';

    // This onRenderHtml() hook defines the HTML structure, see https://vike.dev/render-modes#html-only
    let pageHtml = ''
    if (Page) {
        // We are assuming Page functions return an HTML string
        // If using a framework (React, Vue, Svelte), logic would differ
        pageHtml = typeof Page === 'function' ? Page(pageProps) : String(Page)
    } else {
        // Handle cases where Page might not be defined (e.g., error pages without specific content)
        pageHtml = '<p>Page content could not be loaded.</p>';
    }

    // Read title from pageContext, fallback to default
    const documentProps = {
        title: title || exports?.title || 'Unofficial California Education Policies Navigator',
        description: description, // Use the description retrieved from pageProps
    }

    const documentHtml = escapeInject`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="${documentProps.description}" />
        <!-- Leaflet CSS (consider bundling with Vite later) -->
        <!-- <link rel="stylesheet" href="/leaflet/leaflet.css" /> -->
        <!-- Vike/Vite handles CSS/JS injection for bundled assets -->
        <title>${documentProps.title}</title>
      </head>
      <body>
        <header>
            <h1><a href="/">${String(documentProps.title)}</a></h1>
            <!-- Simple Nav Placeholder -->
            <nav>
                <a href="/">Home</a>
                <!-- <a href="/about">About</a> -->
            </nav>
        </header>
        <main id="page-view">${dangerouslySkipEscape(pageHtml)}</main> <!-- Render page content -->
        <footer>
            <p>&copy; ${String(new Date().getFullYear())} ${String(documentProps.title)}. All rights reserved.</p>
        </footer>
        <!-- Inject pageProps for the client, providing a fallback -->
        <script id="page-props" type="application/json">${dangerouslySkipEscape(JSON.stringify(pageProps || {}))}</script>
        <!-- Leaflet JS (consider bundling with Vite later) -->
        <!-- <script src="/leaflet/leaflet.js"></script> -->
      </body>
    </html>`

    return {
        documentHtml,
        pageContext: {
            // Potentially pass down computed values if needed by client beyond pageProps
        }
    }
}

export default onRenderHtml 