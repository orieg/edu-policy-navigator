// src/types.ts

// Type definition for site configuration
export interface SiteConfig {
    title: string;
    description: string;
    url: string;
    logo: string;
    lastUpdated: Date;
    githubUrl: string;
}

// Type for the main districts data object (keyed by CDS Code)
export interface DistrictDataMap {
    [id: string]: DistrictDetails;
}

// Type for individual district details
export interface DistrictDetails {
    [key: string]: string | number | null;
    // Ensure specific keys exist
    'CDS Code': string;
    'District': string;
    'County': string;
    'Status': string;
    'Street Address': string;
    'Street City': string;
    'Street State': string;
    'Street Zip': string;
    'Phone': string;
    'Low Grade': string;
    'High Grade': string;
    'Latitude': string;
    'Longitude': string;
    'Website': string;
    'slug': string;
    // Add other relevant fields from districts.json
}

// Type for individual school details
export interface SchoolDetails {
    [key: string]: string | number | null;
    // Ensure specific keys exist
    'CDS Code': string;
    'School': string;
    'Status': string;
    'Public Yes/No': string;
    'Educational Program Type': string;
    'Street Address': string;
    'Street City': string;
    'Street State': string;
    'Street Zip': string;
    'Phone': string;
    'Latitude': string;
    'Longitude': string;
    'Low Grade': string;
    'High Grade': string;
    'Website': string;
    // Add other relevant fields from schools.json
}

// Type for schools data grouped by district prefix
export interface SchoolsByDistrictMap {
    [districtCdsPrefix: string]: SchoolDetails[];
} 