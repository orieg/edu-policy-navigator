import type { OnBeforeRenderAsync, PageContext } from 'vike/types'

export const onBeforeRender: OnBeforeRenderAsync = async (pageContext: PageContext) => {
    const pageProps = {}; // No specific props needed for index page for now
    const title = "Unofficial California Education Policies Navigator";
    const description = "Explore California K-12 school district data and policies.";

    return {
        pageContext: {
            pageProps,
            title,
            description
        }
    };
} 