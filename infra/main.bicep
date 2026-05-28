// Resource-group-scoped deployment for create-ad-cut.
//
// Goal: a fork-and-go IaC. After `azd up` everything below exists and is
// wired without any manual key copying:
//   - User-assigned managed identity (created first; principal known up front)
//   - Log Analytics + Container Apps Environment
//   - Azure Container Registry
//   - Storage account + blob container
//   - Cosmos DB (SQL) account / database / container
//   - Azure OpenAI account + 2 model deployments
//   - Container App (FastAPI backend) with secrets from AOAI listKeys()
//   - Static Web App with Linked Backend → Container App
//
// Why UAMI: when a system-assigned identity is used, AcrPull is granted only
// after the ACA has its first revision. The first revision then races with
// AAD propagation and dies with `Operation expired`. With UAMI we know the
// principalId before ACA exists, grant AcrPull first, then create ACA with
// `dependsOn: [acrPull]` — first deploy is reliable.

targetScope = 'resourceGroup'

@minLength(2)
@maxLength(20)
@description('Short environment name; used to derive resource names.')
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Region the Static Web App is created in.')
param staticWebAppLocation string = location

// ---- Azure OpenAI configuration ------------------------------------------
@description('Region for the Azure OpenAI account. Override if your subscription has model availability in a different region.')
param openAiLocation string = location

param azureOpenAiApiVersion string = '2025-04-01-preview'

@description('Deployment name used by the backend for the analysis (chat) model.')
param azureOpenAiAnalysisDeployment string = 'gpt-5.4'

@description('Underlying analysis model name (e.g. gpt-5.4, gpt-5, gpt-4o).')
param azureOpenAiAnalysisModel string = 'gpt-5.4'

@description('Analysis model version. AOAI requires an explicit version.')
param azureOpenAiAnalysisModelVersion string = '2026-03-05'

param azureOpenAiAnalysisSku string = 'GlobalStandard'
param azureOpenAiAnalysisCapacity int = 50

@description('Deployment name used by the backend for the image model.')
param azureOpenAiImageDeployment string = 'gpt-image-2'

@description('Underlying image model name.')
param azureOpenAiImageModel string = 'gpt-image-2'

@description('Image model version. AOAI requires an explicit version.')
param azureOpenAiImageModelVersion string = '2026-04-21'

param azureOpenAiImageSku string = 'GlobalStandard'
param azureOpenAiImageCapacity int = 4

// ---- Naming ---------------------------------------------------------------
var abbrs = loadJsonContent('./abbreviations.json')
var token = uniqueString(subscription().id, resourceGroup().id, environmentName)
var tags = {
    'azd-env-name': environmentName
    project: 'create-ad-cut'
}

var uamiName = '${abbrs.userAssignedIdentity}-${environmentName}-${token}'
var logName = '${abbrs.logAnalyticsWorkspace}-${environmentName}-${token}'
var caEnvName = '${abbrs.containerAppsEnvironment}-${environmentName}-${token}'
var acrName = toLower(replace('${abbrs.containerRegistry}${environmentName}${token}', '-', ''))
var stName = toLower(replace('${abbrs.storageAccount}${environmentName}${token}', '-', ''))
var cosmosName = toLower('${abbrs.cosmosDbAccount}-${environmentName}-${token}')
var aoaiName = toLower('${abbrs.openAiAccount}-${environmentName}-${token}')
var caName = '${abbrs.containerApp}-${environmentName}-${token}'
var swaName = '${abbrs.staticWebApp}-${environmentName}-${token}'

// ---- Identity (created first so AcrPull/RBAC can target a known principal)
module uami 'modules/uami.bicep' = {
    name: 'uami'
    params: {
        location: location
        name: uamiName
        tags: tags
    }
}

// ---- Platform resources ---------------------------------------------------
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

module openai 'modules/openai.bicep' = {
    name: 'openai'
    params: {
        location: openAiLocation
        name: aoaiName
        tags: tags
        analysisDeploymentName: azureOpenAiAnalysisDeployment
        analysisModelName: azureOpenAiAnalysisModel
        analysisModelVersion: azureOpenAiAnalysisModelVersion
        analysisSkuName: azureOpenAiAnalysisSku
        analysisCapacity: azureOpenAiAnalysisCapacity
        imageDeploymentName: azureOpenAiImageDeployment
        imageModelName: azureOpenAiImageModel
        imageModelVersion: azureOpenAiImageModelVersion
        imageSkuName: azureOpenAiImageSku
        imageCapacity: azureOpenAiImageCapacity
    }
}

// ---- RBAC: grant UAMI before ACA exists ----------------------------------
// AcrPull on ACR
resource acrRes 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' existing = {
    name: acrName
    dependsOn: [acr]
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
    name: guid(acrRes.id, uamiName, 'AcrPull')
    scope: acrRes
    properties: {
        principalId: uami.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionId: subscriptionResourceId(
            'Microsoft.Authorization/roleDefinitions',
            '7f951dda-4ed3-4680-a7ca-43fe172d538d'
        )
    }
}

// Storage Blob Data Contributor on the storage account
resource storageRes 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
    name: stName
    dependsOn: [storage]
}

resource blobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
    name: guid(storageRes.id, uamiName, 'StorageBlobDataContributor')
    scope: storageRes
    properties: {
        principalId: uami.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionId: subscriptionResourceId(
            'Microsoft.Authorization/roleDefinitions',
            'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
        )
    }
}

// Cosmos DB Built-in Data Contributor (data plane) — Cosmos-specific role
// definition (NOT an ARM role), assigned via sqlRoleAssignments. Required
// because the account has `disableLocalAuth: true`.
resource cosmosAcct 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
    name: cosmosName
    dependsOn: [cosmos]
}

resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
    parent: cosmosAcct
    name: guid(cosmosAcct.id, uamiName, 'CosmosDbBuiltInDataContributor')
    properties: {
        principalId: uami.outputs.principalId
        roleDefinitionId: '${cosmosAcct.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
        scope: cosmosAcct.id
    }
}

// Azure OpenAI: grant the UAMI Cognitive Services OpenAI User role so the
// app can move to AAD-based AOAI auth in the future without IaC changes.
resource aoaiAcct 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
    name: aoaiName
    dependsOn: [openai]
}

resource aoaiUserRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
    name: guid(aoaiAcct.id, uamiName, 'CognitiveServicesOpenAIUser')
    scope: aoaiAcct
    properties: {
        principalId: uami.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionId: subscriptionResourceId(
            'Microsoft.Authorization/roleDefinitions',
            '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
        )
    }
}

// ---- Container App --------------------------------------------------------
// AOAI is called via AAD using the UAMI (Cognitive Services OpenAI User role
// granted above). The subscription forces `disableLocalAuth: true` on AOAI
// so listKeys() is unavailable; AAD is the only path.
module backend 'modules/containerapp.bicep' = {
    name: 'backend'
    params: {
        location: location
        name: caName
        tags: tags
        environmentId: caenv.outputs.id
        containerRegistryLoginServer: acr.outputs.loginServer
        userAssignedIdentityId: uami.outputs.id
        userAssignedIdentityClientId: uami.outputs.clientId
        azureOpenAiEndpoint: openai.outputs.endpoint
        azureOpenAiApiVersion: azureOpenAiApiVersion
        azureOpenAiAnalysisDeployment: openai.outputs.analysisDeploymentName
        azureOpenAiImageDeployment: openai.outputs.imageDeploymentName
        storageAccountName: storage.outputs.name
        blobContainerName: storage.outputs.containerName
        cosmosEndpoint: cosmos.outputs.endpoint
        cosmosDatabaseName: cosmos.outputs.databaseName
        cosmosContainerName: cosmos.outputs.containerName
    }
    dependsOn: [acrPull, aoaiUserRole]
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
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = acr.outputs.loginServer

output AZURE_USER_ASSIGNED_IDENTITY_ID string = uami.outputs.id
output AZURE_USER_ASSIGNED_IDENTITY_CLIENT_ID string = uami.outputs.clientId

output BACKEND_NAME string = backend.outputs.name
output BACKEND_FQDN string = backend.outputs.fqdn

output AZURE_OPENAI_NAME string = openai.outputs.name
output AZURE_OPENAI_ENDPOINT string = openai.outputs.endpoint
output AZURE_OPENAI_ANALYSIS_DEPLOYMENT string = openai.outputs.analysisDeploymentName
output AZURE_OPENAI_IMAGE_DEPLOYMENT string = openai.outputs.imageDeploymentName

output STORAGE_ACCOUNT_NAME string = storage.outputs.name
output BLOB_CONTAINER_NAME string = storage.outputs.containerName
output BLOB_ENDPOINT string = storage.outputs.blobEndpoint

output COSMOS_ACCOUNT_NAME string = cosmos.outputs.name
output COSMOS_ENDPOINT string = cosmos.outputs.endpoint
output COSMOS_DATABASE_NAME string = cosmos.outputs.databaseName
output COSMOS_CONTAINER_NAME string = cosmos.outputs.containerName

output SWA_NAME string = swa.outputs.name
output SWA_HOSTNAME string = swa.outputs.hostname
