// Container Apps managed environment wired to a Log Analytics workspace.

param location string
param name string
param tags object = {}
param logAnalyticsWorkspaceCustomerId string
@secure()
param logAnalyticsWorkspaceSharedKey string

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
    name: name
    location: location
    tags: tags
    properties: {
        appLogsConfiguration: {
            destination: 'log-analytics'
            logAnalyticsConfiguration: {
                customerId: logAnalyticsWorkspaceCustomerId
                sharedKey: logAnalyticsWorkspaceSharedKey
            }
        }
    }
}

output id string = env.id
output defaultDomain string = env.properties.defaultDomain
