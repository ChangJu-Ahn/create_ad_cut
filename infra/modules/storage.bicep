// Storage account + private 'studio' blob container.
// Shared-key auth is disabled (policy-aligned); consumers authenticate via
// AAD (DefaultAzureCredential) and sign SAS URLs with a user delegation key.

param location string
param name string
param tags object = {}
param containerName string = 'studio'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
    name: name
    location: location
    tags: tags
    sku: { name: 'Standard_LRS' }
    kind: 'StorageV2'
    properties: {
        allowBlobPublicAccess: false
        allowSharedKeyAccess: false
        minimumTlsVersion: 'TLS1_2'
        publicNetworkAccess: 'Enabled'
        supportsHttpsTrafficOnly: true
    }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
    parent: storage
    name: 'default'
    properties: {
        deleteRetentionPolicy: { enabled: true, days: 7 }
    }
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
    parent: blobService
    name: containerName
    properties: { publicAccess: 'None' }
}

output id string = storage.id
output name string = storage.name
output containerName string = container.name
output blobEndpoint string = storage.properties.primaryEndpoints.blob
