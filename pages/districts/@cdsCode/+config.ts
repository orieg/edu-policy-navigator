import type { Config } from 'vike/types'

export default {
    // Enable pre-rendering (Static Site Generation)
    prerender: true
    // title: 'Unofficial District Details' // Title is set dynamically in +onBeforeRender.ts
    // We might need to add onBeforePrerender hook later if Vike
    // cannot automatically discover all possible `cdsCode` values
    // from the data source to generate all pages during build.
} 