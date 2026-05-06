// Azure Container Registry (Basic) — admin user disabled, Container App pulls
// via system-assigned managed identity (AcrPull role assignment below).

param location string
param name string
param tags object = {}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
    name: name
    location: location
    tags: tags
    sku: { name: 'Basic' }
    properties: {
        adminUserEnabled: false
        publicNetworkAccess: 'Enabled'
        anonymousPullEnabled: false
    }
}

output id string = acr.id
output name string = acr.name
output loginServer string = acr.properties.loginServer
