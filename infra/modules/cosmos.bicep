// Cosmos DB (NoSQL) — single-region account with one DB and one container.
// Partition key `/sessionId` is high-cardinality, every query is single-partition.
// Local auth is disabled (policy-aligned); consumers authenticate via AAD.

param location string
param accountName string
param tags object = {}
param databaseName string = 'studio'
param containerName string = 'sessions'

resource account 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
    name: accountName
    location: location
    tags: tags
    kind: 'GlobalDocumentDB'
    properties: {
        databaseAccountOfferType: 'Standard'
        consistencyPolicy: { defaultConsistencyLevel: 'Session' }
        locations: [
            {
                locationName: location
                failoverPriority: 0
                isZoneRedundant: false
            }
        ]
        capabilities: [ { name: 'EnableServerless' } ]
        publicNetworkAccess: 'Enabled'
        disableLocalAuth: true
    }
}

resource db 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
    parent: account
    name: databaseName
    properties: { resource: { id: databaseName } }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
    parent: db
    name: containerName
    properties: {
        resource: {
            id: containerName
            partitionKey: { paths: [ '/sessionId' ], kind: 'Hash' }
            indexingPolicy: { indexingMode: 'consistent', automatic: true }
        }
    }
}

output id string = account.id
output name string = account.name
output endpoint string = account.properties.documentEndpoint
output databaseName string = db.name
output containerName string = container.name
