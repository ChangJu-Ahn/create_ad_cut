// Static Web App with a linked Container App backend.
// SWA Standard tier is required for `linkedBackends`.

param location string
param name string
param tags object = {}
param backendResourceId string
param backendRegion string

resource swa 'Microsoft.Web/staticSites@2024-04-01' = {
    name: name
    location: location
    tags: union(tags, { 'azd-service-name': 'frontend' })
    sku: { name: 'Standard', tier: 'Standard' }
    properties: {
        provider: 'GitHub'
        buildProperties: {
            appLocation: '/frontend'
            outputLocation: 'dist'
        }
    }
}

resource link 'Microsoft.Web/staticSites/linkedBackends@2024-04-01' = {
    parent: swa
    name: 'backend'
    properties: {
        backendResourceId: backendResourceId
        region: backendRegion
    }
}

output id string = swa.id
output name string = swa.name
output hostname string = swa.properties.defaultHostname
