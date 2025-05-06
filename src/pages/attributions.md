---
layout: ../layouts/BaseLayout.astro
title: "Data Sources & Attributions"
description: "Information about the data sources used and open source projects that power this site."
breadcrumbs:
  - { text: "Home", href: "/" }
  - { text: "Data Sources & Attributions" }
---

This page details the primary data sources used for the information presented on this website and acknowledges the open source projects that make this site possible.

## Data Sources

We strive to use publicly available, authoritative data. Key sources include:

*   **California Department of Education (CDE):**
    *   School directory information, district attributes, and various educational datasets (typically sourced from [CDE Website](https://www.cde.ca.gov/SchoolDirectory/ExportSelect)).
    *   School district boundary GIS data (GeoJSON format), sourced from the [State of California Open Data Portal (data.ca.gov)](https://lab.data.ca.gov/dataset/california-school-district-areas-2023-24) and maintained by the CDE.
*   **Local School District Websites:** For Board Policies (BP) and Administrative Regulations (AR).
*   **California Legislative Information:** For California Education Code sections.
*   **OpenStreetMap:** For geocoding data used in map features (via Nominatim).

Policy information is synthesized from these public sources. While efforts are made to ensure accuracy, users should always verify critical information against official documents from the respective governing bodies.

## Open Source Attributions

This project is built with and relies on several fantastic open source projects. We are grateful to their contributors:

*   **Framework & Build Tools:**
    *   [Astro](https://astro.build/): The web framework used to build this static site.
    *   [Vite](https://vitejs.dev/): Frontend tooling that provides a faster and leaner development experience.
*   **Mapping Libraries:**
    *   [LeafletJS](https://leafletjs.com/): An open-source JavaScript library for mobile-friendly interactive maps.
    *   [Proj4js](https://proj4js.org/): A JavaScript library to transform point coordinates from one coordinate system to another.
    *   [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster): A Leaflet plugin for clustering markers.
    *   [leaflet-geosearch](https://github.com/smeijer/leaflet-geosearch): A Leaflet plugin for geocoding and search, utilizing OpenStreetMap.
*   **Icons:**
    *   [Tabler Icons](https://tabler-icons.io/): A set of free, open source SVG icons.
*   **Data Processing & Backend (Pipeline/Build-time):**
    *   [Node.js](https://nodejs.org/): JavaScript runtime environment.
    *   [Nominatim](https://nominatim.org/): Open-source search engine for OpenStreetMap data.
    *   Docker Image for Nominatim: [mediagis/nominatim](https://hub.docker.com/r/mediagis/nominatim) (used for local geocoding service during data preparation).
*   **(Planned/In-Browser AI - if implemented):**
    *   *[WebLLM (mlc-ai)](https://github.com/mlc-ai/web-llm): For potential in-browser LLM capabilities.*
    *   *[KuzuDB WASM](https://kuzudb.com/): For potential in-browser graph database capabilities.*

This website itself is open source and can be found on [GitHub](https://github.com/orieg/edu-policy-navigator).

---

*This list is maintained to the best of our ability. If you believe there are any omissions or errors, please [open an issue](https://github.com/orieg/edu-policy-navigator/issues) on our GitHub repository.* 