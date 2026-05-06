// Resource-group-scoped deployment for create-ad-cut.
// Provisions Storage, Cosmos DB, ACR, Container Apps Environment + App, and
// a Static Web App with a Linked Backend pointing at the Container App.
//
// Azure OpenAI is assumed to be pre-deployed (gpt-5.x + gpt-image-2). Its
// endpoint and API key are passed in as parameters and stored as Container
// App secrets.

targetScope = 'resourceGroup'

@minLength(2)
@maxLength(20)
@description('Short environment name; used to derive resource names.')
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Region the Static Web App is created in. SWA Linked Backend must support this region pair (default: same as backend).')
param staticWebAppLocation string = location

// ---- Pre-deployed Azure OpenAI (assumed to exist) -------------------------
@secure()
@description('Endpoint URL of the pre-deployed Azure OpenAI resource.')
param azureOpenAiEndpoint string

@secure()
@description('API key of the pre-deployed Azure OpenAI resource.')
param azureOpenAiApiKey string

param azureOpenAiApiVersion string = '2025-04-01-preview'
param azureOpenAiAnalysisDeployment string = 'gpt-5.5'
param azureOpenAiImageDeployment string = 'gpt-image-2'

// ---- App secret -----------------------------------------------------------
@secure()
@description('Value clients must send in the X-API-Key header.')
param backendApiKey string

// ---- Naming ---------------------------------------------------------------
var abbrs = loadJsonContent('./abbreviations.json')
var token = uniqueString(subscription().id, resourceGroup().id, environmentName)
var tags = {
    'azd-env-name': environmentName
    project: 'create-ad-cut'
}

var logName = '${abbrs.logAnalyticsWorkspace}-${environmentName}-${token}'
var caEnvName = '${abbrs.containerAppsEnvironment}-${environmentName}-${token}'
var acrName = toLower(replace('${abbrs.containerRegistry}${environmentName}${token}', '-', ''))
var stName = toLower(replace('${abbrs.storageAccount}${environmentName}${token}', '-', ''))
var cosmosName = toLower('${abbrs.cosmosDbAccount}-${environmentName}-${token}')
var caName = '${abbrs.containerApp}-${environmentName}-${token}'
var swaName = '${abbrs.staticWebApp}-${environmentName}-${token}'

// ---- Modules --------------------------------------------------------------
module logws 'modules/loganalytics.bicep' = {
    name: 'log'
    params: {
        location: location
        name: logName
        tags: tags
    }
}

module caenv 'modules/containerappenv.bicep' = {
    name: 'caenv'
    params: {
        location: location
        name: caEnvName
        tags: tags
        logAnalyticsWorkspaceCustomerId: logws.outputs.customerId
        logAnalyticsWorkspaceSharedKey: logws.outputs.sharedKey
    }
}

module acr 'modules/containerregistry.bicep' = {
    name: 'acr'
    params: {
        location: location
        name: acrName
        tags: tags
    }
}

module storage 'modules/storage.bicep' = {
    name: 'storage'
    params: {
        location: location
        name: stName
        tags: tags
        containerName: 'studio'
    }
}

module cosmos 'modules/cosmos.bicep' = {
    name: 'cosmos'
    params: {
        location: location
        accountName: cosmosName
        tags: tags
        databaseName: 'studio'
        containerName: 'sessions'
    }
}

module backend 'modules/containerapp.bicep' = {
    name: 'backend'
    params: {
        location: location
        name: caName
        tags: tags
        environmentId: caenv.outputs.id
        containerRegistryLoginServer: acr.outputs.loginServer
        backendApiKey: backendApiKey
        azureOpenAiEndpoint: azureOpenAiEndpoint
        azureOpenAiApiKey: azureOpenAiApiKey
        azureOpenAiApiVersion: azureOpenAiApiVersion
        azureOpenAiAnalysisDeployment: azureOpenAiAnalysisDeployment
        azureOpenAiImageDeployment: azureOpenAiImageDeployment
        storageAccountName: storage.outputs.name
        blobContainerName: storage.outputs.containerName
        cosmosEndpoint: cosmos.outputs.endpoint
        cosmosDatabaseName: cosmos.outputs.databaseName
        cosmosContainerName: cosmos.outputs.containerName
    }
}

// AcrPull role assignment for the Container App's system-assigned identity.
// The role assignment name must be deterministic at compile time; we seed it
// with stable values (resource-group id + container-app name) instead of the
// runtime principalId.
resource acrRes 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
    name: acrName
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
    name: guid(acrRes.id, caName, 'AcrPull')
    scope: acrRes
    properties: {
        principalId: backend.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionId: subscriptionResourceId(
            'Microsoft.Authorization/roleDefinitions',
            '7f951dda-4ed3-4680-a7ca-43fe172d538d'
        )
    }
}

// Storage Blob Data Contributor on the storage account so the Container App
// can upload blobs and request user delegation keys for SAS.
resource storageRes 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
    name: stName
}

resource blobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
    name: guid(storageRes.id, caName, 'StorageBlobDataContributor')
    scope: storageRes
    properties: {
        principalId: backend.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionId: subscriptionResourceId(
            'Microsoft.Authorization/roleDefinitions',
            'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
        )
    }
}

// Cosmos DB Built-in Data Contributor (data plane) — required because the
// account has `disableLocalAuth: true`. This is a Cosmos-specific role
// definition (NOT an ARM role), assigned via sqlRoleAssignments.
resource cosmosAcct 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
    name: cosmosName
}

resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
    parent: cosmosAcct
    name: guid(cosmosAcct.id, caName, 'CosmosDbBuiltInDataContributor')
    properties: {
        principalId: backend.outputs.principalId
        roleDefinitionId: '${cosmosAcct.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
        scope: cosmosAcct.id
    }
}

module swa 'modules/staticwebapp.bicep' = {
    name: 'swa'
    params: {
        location: staticWebAppLocation
        name: swaName
        tags: tags
        backendResourceId: backend.outputs.id
        backendRegion: location
    }
}

// ---- Outputs (consumed by azd / GitHub Actions) ---------------------------
output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup().name

output ACR_NAME string = acr.outputs.name
output ACR_LOGIN_SERVER string = acr.outputs.loginServer

output BACKEND_NAME string = backend.outputs.name
output BACKEND_FQDN string = backend.outputs.fqdn

output STORAGE_ACCOUNT_NAME string = storage.outputs.name
output BLOB_CONTAINER_NAME string = storage.outputs.containerName
output BLOB_ENDPOINT string = storage.outputs.blobEndpoint

output COSMOS_ACCOUNT_NAME string = cosmos.outputs.name
output COSMOS_ENDPOINT string = cosmos.outputs.endpoint
output COSMOS_DATABASE_NAME string = cosmos.outputs.databaseName
output COSMOS_CONTAINER_NAME string = cosmos.outputs.containerName

output SWA_NAME string = swa.outputs.name
output SWA_HOSTNAME string = swa.outputs.hostname
