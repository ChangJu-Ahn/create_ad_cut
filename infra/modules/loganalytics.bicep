// Log Analytics workspace shared by Container Apps and (optionally) App Insights.

@description('Location for the workspace.')
param location string

@description('Workspace name.')
param name string

@description('Common tags.')
param tags object = {}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
    name: name
    location: location
    tags: tags
    properties: {
        sku: { name: 'PerGB2018' }
        retentionInDays: 30
        features: { enableLogAccessUsingOnlyResourcePermissions: true }
    }
}

output id string = workspace.id
output customerId string = workspace.properties.customerId
#disable-next-line outputs-should-not-contain-secrets
output sharedKey string = workspace.listKeys().primarySharedKey
