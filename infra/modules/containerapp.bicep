// Container App for the FastAPI backend.
// - System-assigned managed identity (used to pull from ACR via AcrPull
//   role and to authenticate to Cosmos / Storage via AAD).
// - Only the backend API key + AOAI key are stored as secrets. Storage and
//   Cosmos use AAD because the policy on this subscription forces both to
//   `disableLocalAuth: true` / `allowSharedKeyAccess: false`.
// - On bootstrap deploys a placeholder image; CI updates the image afterwards.

param location string
param name string
param tags object = {}
param environmentId string
param containerRegistryLoginServer string
param containerImage string = 'mcr.microsoft.com/azuredocs/aci-helloworld:latest'

@secure()
param backendApiKey string

@secure()
param azureOpenAiEndpoint string

@secure()
param azureOpenAiApiKey string

param azureOpenAiApiVersion string
param azureOpenAiAnalysisDeployment string
param azureOpenAiImageDeployment string

param storageAccountName string
param blobContainerName string
param cosmosEndpoint string
param cosmosDatabaseName string
param cosmosContainerName string
param corsOrigins string = ''

resource app 'Microsoft.App/containerApps@2024-03-01' = {
    name: name
    location: location
    tags: union(tags, { 'azd-service-name': 'backend' })
    identity: { type: 'SystemAssigned' }
    properties: {
        managedEnvironmentId: environmentId
        configuration: {
            activeRevisionsMode: 'Single'
            ingress: {
                external: true
                targetPort: 8000
                transport: 'auto'
                allowInsecure: false
            }
            registries: [
                {
                    server: containerRegistryLoginServer
                    identity: 'system'
                }
            ]
            secrets: [
                { name: 'backend-api-key', value: backendApiKey }
                { name: 'aoai-endpoint', value: azureOpenAiEndpoint }
                { name: 'aoai-api-key', value: azureOpenAiApiKey }
            ]
        }
        template: {
            containers: [
                {
                    name: 'backend'
                    image: containerImage
                    resources: { cpu: json('1.0'), memory: '2Gi' }
                    env: [
                        { name: 'BACKEND_API_KEY', secretRef: 'backend-api-key' }
                        { name: 'AZURE_OPENAI_ENDPOINT', secretRef: 'aoai-endpoint' }
                        { name: 'AZURE_OPENAI_API_KEY', secretRef: 'aoai-api-key' }
                        { name: 'AZURE_OPENAI_API_VERSION', value: azureOpenAiApiVersion }
                        { name: 'AZURE_OPENAI_ANALYSIS_DEPLOYMENT', value: azureOpenAiAnalysisDeployment }
                        { name: 'AZURE_OPENAI_IMAGE_DEPLOYMENT', value: azureOpenAiImageDeployment }
                        { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: storageAccountName }
                        { name: 'BLOB_CONTAINER_NAME', value: blobContainerName }
                        { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
                        { name: 'COSMOS_DATABASE_NAME', value: cosmosDatabaseName }
                        { name: 'COSMOS_CONTAINER_NAME', value: cosmosContainerName }
                        { name: 'CORS_ORIGINS', value: corsOrigins }
                        { name: 'LOG_LEVEL', value: 'INFO' }
                    ]
                    probes: [
                        {
                            type: 'Liveness'
                            httpGet: { path: '/healthz', port: 8000 }
                            initialDelaySeconds: 10
                            periodSeconds: 30
                        }
                    ]
                }
            ]
            scale: {
                minReplicas: 1
                maxReplicas: 5
                rules: [
                    {
                        name: 'http-rule'
                        http: { metadata: { concurrentRequests: '20' } }
                    }
                ]
            }
        }
    }
}

output id string = app.id
output name string = app.name
output fqdn string = app.properties.configuration.ingress.fqdn
output principalId string = app.identity.principalId
