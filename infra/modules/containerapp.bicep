// Container App for the FastAPI backend.
//
// Identity: User-assigned managed identity passed in from main.bicep. The
// UAMI is created before all data-plane role assignments (AcrPull, Storage
// Blob Data Contributor, Cosmos Data Contributor, Cognitive Services OpenAI
// User), so the very first revision can authenticate cleanly. This avoids
// the first-deploy race where a system-identity ACA boots before its AcrPull
// role has propagated and the revision times out with `Operation expired`.
//
// On bootstrap deploys a placeholder image; CI/azd swap in the real image
// afterwards.

param location string
param name string
param tags object = {}
param environmentId string
param containerRegistryLoginServer string
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'
var isBootstrapPlaceholderImage = contains(containerImage, 'k8se/quickstart') || contains(containerImage, 'aci-helloworld')

@description('Resource id of the user-assigned managed identity to attach.')
param userAssignedIdentityId string

@description('Client id of the user-assigned managed identity. Surfaced as AZURE_CLIENT_ID inside the container so DefaultAzureCredential picks this identity unambiguously.')
param userAssignedIdentityClientId string

@secure()
param backendApiKey string

@secure()
param azureOpenAiEndpoint string

param azureOpenAiApiVersion string
param azureOpenAiAnalysisDeployment string
param azureOpenAiImageDeployment string

param storageAccountName string
param blobContainerName string
param cosmosEndpoint string
param cosmosDatabaseName string
param cosmosContainerName string
param corsOrigins string = ''

// The bootstrap placeholder image listens on port 80.
// Use a matching ingress target port during infra provisioning so the first
// revision can become healthy. Real backend deployments set port 8000 via
// the postdeploy hook.
var ingressTargetPort = isBootstrapPlaceholderImage ? 80 : 8000

resource app 'Microsoft.App/containerApps@2024-03-01' = {
    name: name
    location: location
    tags: union(tags, { 'azd-service-name': 'backend' })
    identity: {
        type: 'UserAssigned'
        userAssignedIdentities: {
            '${userAssignedIdentityId}': {}
        }
    }
    properties: {
        managedEnvironmentId: environmentId
        configuration: {
            activeRevisionsMode: 'Single'
            ingress: {
                external: true
                targetPort: ingressTargetPort
                transport: 'auto'
                allowInsecure: false
            }
            registries: [
                {
                    server: containerRegistryLoginServer
                    identity: userAssignedIdentityId
                }
            ]
            secrets: [
                { name: 'backend-api-key', value: backendApiKey }
                { name: 'aoai-endpoint', value: azureOpenAiEndpoint }
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
                        { name: 'AZURE_OPENAI_API_VERSION', value: azureOpenAiApiVersion }
                        { name: 'AZURE_OPENAI_ANALYSIS_DEPLOYMENT', value: azureOpenAiAnalysisDeployment }
                        { name: 'AZURE_OPENAI_IMAGE_DEPLOYMENT', value: azureOpenAiImageDeployment }
                        { name: 'AZURE_CLIENT_ID', value: userAssignedIdentityClientId }
                        { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: storageAccountName }
                        { name: 'BLOB_CONTAINER_NAME', value: blobContainerName }
                        { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
                        { name: 'COSMOS_DATABASE_NAME', value: cosmosDatabaseName }
                        { name: 'COSMOS_CONTAINER_NAME', value: cosmosContainerName }
                        { name: 'CORS_ORIGINS', value: corsOrigins }
                        { name: 'LOG_LEVEL', value: 'INFO' }
                    ]
                    probes: isBootstrapPlaceholderImage
                        ? []
                        : [
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
