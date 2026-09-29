import pytest

from app.config import Settings


def production_settings(**overrides):
    values = {
        "environment": "production",
        "database_backend": "supabase",
        "demo_mode": False,
        "jwt_secret": "a-strong-production-secret-value",
        "supabase_url": "https://example.supabase.co",
        "supabase_anon_key": "anon-key",
        "supabase_service_role_key": "service-role-key",
        "cors_origins": "http://localhost:5173,https://t4-pf-nationals.vercel.app",
    }
    values.update(overrides)
    return Settings(**values)


def test_production_rejects_demo_mode():
    with pytest.raises(RuntimeError, match="DEMO_MODE"):
        production_settings(demo_mode=True).validate_runtime()


def test_production_requires_all_supabase_credentials():
    with pytest.raises(RuntimeError, match="SUPABASE"):
        production_settings(supabase_service_role_key=None).validate_runtime()


def test_production_requires_https_cors_origin():
    with pytest.raises(RuntimeError, match="HTTPS"):
        production_settings(cors_origins="http://localhost:5173").validate_runtime()
