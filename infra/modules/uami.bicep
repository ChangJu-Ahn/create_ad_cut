// User-assigned managed identity used by the Container App.
// Created BEFORE the Container App so AcrPull / data-plane role assignments
// can be made against a known principalId, eliminating the first-deploy race
// where ACA boots before its system-identity has AcrPull on the registry.

param location string
param name string
param tags object = {}

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
    name: name
    location: location
    tags: tags
}

output id string = uami.id
output name string = uami.name
output principalId string = uami.properties.principalId
output clientId string = uami.properties.clientId
