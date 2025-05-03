// renderer/+onRenderHtml.tsx
// Environment: server

import { dangerouslySkipEscape, escapeInject } from 'vike/server'
import type { OnRenderHtmlAsync } from 'vike/types'
// import logoUrl from './logo.svg' // Removed unused logo import for now

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

    const documentProps = {
        // Use type assertion or default value for title
        // title: (pageContext as any).title ?? exports.title ?? 'CA Edu Policy Navigator',
        title: title ?? exports?.title ?? 'Unofficial CA Edu Policy Navigator', // Updated default title
        description: pageProps?.description ?? 'Navigating California K-12 education policies and data.'
    }

    const pagePropsJson = dangerouslySkipEscape(JSON.stringify(pageProps || {}))

    const pageHtml = typeof Page === 'function' ? Page(pageProps) : '<!-- Page component failed to render -->'

    const documentHtml = escapeInject`<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="${documentProps.description}" />
        <!-- Leaflet CSS (consider bundling with Vite later) -->
        <!-- <link rel="stylesheet" href="/leaflet/leaflet.css" /> -->
        <!-- Vike/Vite handles CSS/JS injection for bundled assets -->
        <title>${String(documentProps.title)}</title>
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
        <!-- Inject pageProps for the client -->
        <script id="page-props" type="application/json">${pagePropsJson}</script>
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