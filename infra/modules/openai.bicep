// Azure OpenAI account + model deployments.
// The two deployments are chained with dependsOn because Cognitive Services
// rejects parallel deployment creates on the same account with 409 Conflict.

param location string
param name string
param tags object = {}

@description('Custom subdomain for the AOAI endpoint. Must be globally unique.')
param customSubDomain string = name

@description('Analysis (chat) model deployment name (used by the backend).')
param analysisDeploymentName string

@description('Analysis model name as registered in Azure OpenAI (e.g. gpt-5, gpt-4o).')
param analysisModelName string

@description('Analysis model version. Empty string means latest available.')
param analysisModelVersion string = ''

@description('SKU name for the analysis deployment (GlobalStandard / Standard / ProvisionedManaged).')
param analysisSkuName string = 'GlobalStandard'

@description('Capacity for the analysis deployment (TPM in thousands for chat models).')
param analysisCapacity int = 50

@description('Image model deployment name (used by the backend).')
param imageDeploymentName string

@description('Image model name (e.g. gpt-image-2, gpt-image-1).')
param imageModelName string

@description('Image model version. Empty string means latest available.')
param imageModelVersion string = ''

@description('SKU name for the image deployment.')
param imageSkuName string = 'GlobalStandard'

@description('Capacity for the image deployment.')
param imageCapacity int = 1

// Microsoft Foundry (AI Services) account. Newer image models such as
// gpt-image-2 are only routable on `kind: AIServices`; the legacy
// `kind: OpenAI` account returns DeploymentNotFound on the data plane
// even when the deployment is created successfully on the control plane.
resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
    name: name
    location: location
    tags: tags
    kind: 'AIServices'
    sku: { name: 'S0' }
    identity: { type: 'SystemAssigned' }
    properties: {
        customSubDomainName: customSubDomain
        publicNetworkAccess: 'Enabled'
        // AAD-only: the backend authenticates with the UAMI via the
        // `Cognitive Services OpenAI User` role. This matches the common
        // tenant-wide policy that forces local-auth off.
        disableLocalAuth: true
    }
}

resource analysisDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
    parent: account
    name: analysisDeploymentName
    sku: {
        name: analysisSkuName
        capacity: analysisCapacity
    }
    properties: {
        model: {
            format: 'OpenAI'
            name: analysisModelName
            version: empty(analysisModelVersion) ? null : analysisModelVersion
        }
    }
}

resource imageDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
    parent: account
    name: imageDeploymentName
    sku: {
        name: imageSkuName
        capacity: imageCapacity
    }
    properties: {
        model: {
            format: 'OpenAI'
            name: imageModelName
            version: empty(imageModelVersion) ? null : imageModelVersion
        }
    }
    dependsOn: [analysisDeployment]
}

output id string = account.id
output name string = account.name
// On AIServices-kind accounts, the OpenAI data plane (incl. gpt-image-2's
// images/generations) is routed via *.cognitiveservices.azure.com, NOT the
// legacy *.openai.azure.com hostname. The latter returns 404
// DeploymentNotFound for gpt-image-2 even when the deployment exists.
// `account.properties.endpoint` already points at cognitiveservices.azure.com.
output endpoint string = account.properties.endpoint
output analysisDeploymentName string = analysisDeployment.name
output imageDeploymentName string = imageDeployment.name
