// types/vike.d.ts
// Tell Vike about our custom pageContext properties

declare global {
    namespace Vike {
        interface PageContext {
            // Property returned by +onBeforeRender
            pageProps?: {
                title?: string;
                description?: string;
                district?: any; // Define specific DistrictDetails type later
                schools?: any[]; // Define specific SchoolDetails type later
                cdsCode?: string;
            };

            // Property returned by +Page.js
            // Page?: (pageProps: PageContext['pageProps']) => any; // Adjust based on Page component type

            // Property available on client-side
            // isHydration?: boolean;

            // Property available on server-side
            // someAsyncProps?: string;

            // Route params (e.g., for /districts/@districtSlug)
            routeParams?: {
                districtSlug?: string;
            };

            // Custom title property (if set by hooks/pages)
            title?: string;
        }
    }
}

// Ensure this file is treated as a module.
export { }; 