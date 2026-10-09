from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://lens:lens_local_only@127.0.0.1:55432/identity_lens"
    allowed_origins: str = "http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:8000"
    secure_cookies: bool = False
    allow_browser_telemetry: bool = False
    allow_hosted_activity: bool = True
    enable_sandbox: bool = True
    public_host: str = ""
    runtime_mode: str = "development"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
