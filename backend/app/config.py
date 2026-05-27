"""Application configuration loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Strongly-typed view over the environment.

    All Azure resources (AOAI, Storage, Cosmos) are assumed to be
    pre-provisioned. Storage and Cosmos use AAD (DefaultAzureCredential):
    locally that resolves to the developer's `az login` identity, and in
    Container Apps to the system-assigned managed identity. Azure OpenAI
    keeps API-key auth so the AOAI resource can live in another sub.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Azure OpenAI (AAD auth via DefaultAzureCredential)
    azure_openai_endpoint: str = Field(..., alias="AZURE_OPENAI_ENDPOINT")
    azure_openai_api_version: str = Field(
        "2025-04-01-preview", alias="AZURE_OPENAI_API_VERSION"
    )
    azure_openai_analysis_deployment: str = Field(
        "gpt-5.4", alias="AZURE_OPENAI_ANALYSIS_DEPLOYMENT"
    )
    azure_openai_image_deployment: str = Field(
        "gpt-image-2", alias="AZURE_OPENAI_IMAGE_DEPLOYMENT"
    )

    # Blob Storage (AAD auth)
    azure_storage_account_name: str = Field(..., alias="AZURE_STORAGE_ACCOUNT_NAME")
    blob_container_name: str = Field("studio", alias="BLOB_CONTAINER_NAME")
    sas_ttl_minutes: int = Field(15, alias="SAS_TTL_MINUTES")

    # Cosmos DB (AAD auth)
    cosmos_endpoint: str = Field(..., alias="COSMOS_ENDPOINT")
    cosmos_database_name: str = Field("studio", alias="COSMOS_DATABASE_NAME")
    cosmos_container_name: str = Field("sessions", alias="COSMOS_CONTAINER_NAME")

    # App
    log_level: str = Field("INFO", alias="LOG_LEVEL")
    cors_origins: str = Field("http://localhost:5173", alias="CORS_ORIGINS")
    # Regex matched against the request Origin in addition to cors_origins.
    # Used for SWA per-PR staging hosts (`<swa>-<N>.<region>.azurestaticapps.net`)
    # which are not knowable at deploy time.
    cors_origin_regex: str = Field("", alias="CORS_ORIGIN_REGEX")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def blob_account_url(self) -> str:
        return f"https://{self.azure_storage_account_name}.blob.core.windows.net"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Singleton accessor — call at import time of the app, then reuse."""
    return Settings()  # type: ignore[call-arg]
