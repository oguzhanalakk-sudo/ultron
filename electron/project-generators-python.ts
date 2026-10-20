// Python (FastAPI) için gömülü, çok dosyalı proje üreticisi.
// Üretilen kod: girdi doğrulama, parametreli ORM sorguları, yapılandırılmış günlük,
// merkezi hata yönetimi, gizli anahtarsız yapılandırma ve güvenli varsayılanlar.
import { draft, readme, safeText, type DraftFile, type GeneratorContext } from './project-generator-kit.ts'

const doc = (text: string): string => `"""${text}"""`

export function fastapiFiles(context: GeneratorContext): DraftFile[] {
  const title = safeText(context.name, 60)
  return [
    draft('requirements.txt', 'Python bağımlılıkları', 'fastapi>=0.115,<1\nuvicorn[standard]>=0.34,<1\nsqlalchemy>=2.0,<3\npydantic>=2.7,<3\npydantic-settings>=2.4,<3\npytest>=8,<9\nhttpx>=0.27,<1'),
    draft('pytest.ini', 'pytest yapılandırması', '[pytest]\npythonpath = .\ntestpaths = tests'),
    draft('.env.example', 'Ortam değişkenleri örneği (gerçek gizli anahtar içermez)', `APP_NAME=${title}\nENVIRONMENT=development\nDEBUG=false\nDATABASE_URL=sqlite:///./app.db\nCORS_ORIGINS=http://localhost:3000\nLOG_LEVEL=INFO\nLOG_JSON=true`),
    draft('.gitignore', 'Git dışı bırakılacak dosyalar', '__pycache__/\n.venv/\n.pytest_cache/\n*.db\n.env\n.env.*\n!.env.example\n*.log\n.DS_Store'),
    draft('app/__init__.py', 'Uygulama paketi', doc('Application package.')),
    draft('app/main.py', 'FastAPI uygulama fabrikası, CORS, istek günlüğü ve yaşam döngüsü', String.raw`${doc('FastAPI application factory.')}
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.db.session import init_db

logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging(settings.log_level, settings.log_json)
    if settings.environment != "test":
        init_db()
    logger.info("application started", extra={"context": {"environment": settings.environment}})
    yield
    logger.info("application stopped")


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        debug=settings.debug,
        lifespan=lifespan,
        docs_url=None if settings.environment == "production" else "/docs",
        redoc_url=None,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type"],
    )
    register_exception_handlers(application)

    @application.middleware("http")
    async def log_requests(request: Request, call_next):
        request_id = uuid.uuid4().hex
        started = time.perf_counter()
        response = await call_next(request)
        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        logger.info(
            "request completed",
            extra={"context": {"request_id": request_id, "method": request.method, "path": request.url.path, "status": response.status_code, "duration_ms": duration_ms}},
        )
        return response

    application.include_router(api_router, prefix="/api/v1")
    return application


app = create_app()
`),
    draft('app/core/__init__.py', 'Çekirdek paket', doc('Core configuration, logging and error handling.')),
    draft('app/core/config.py', 'Ortam değişkenlerinden yapılandırma (güvenli varsayılanlar)', String.raw`${doc('Application settings loaded from environment variables.')}
from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "${title}"
    environment: str = "development"
    debug: bool = False
    database_url: str = "sqlite:///./app.db"
    cors_origins: str = "http://localhost:3000"
    log_level: str = "INFO"
    log_json: bool = True

    @property
    def cors_origin_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip() and origin.strip() != "*"]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
`),
    draft('app/core/logging.py', 'Yapılandırılmış (JSON) günlük kaydı', String.raw`${doc('Structured logging helpers.')}
import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        context = getattr(record, "context", None)
        if isinstance(context, dict):
            payload.update(context)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO", json_output: bool = True) -> None:
    handler = logging.StreamHandler(sys.stdout)
    if json_output:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
`),
    draft('app/core/errors.py', 'Merkezi hata yönetimi ve tutarlı hata gövdesi', String.raw`${doc('Application errors and exception handlers.')}
import logging
from typing import Any, Optional

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    status_code = 400
    code = "app_error"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


def _body(code: str, message: str, details: Optional[Any] = None) -> dict:
    body: dict = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return body


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=_body(exc.code, exc.message))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content=_body("validation_error", "Request validation failed", jsonable_encoder(exc.errors())),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error", extra={"context": {"path": request.url.path}})
        return JSONResponse(status_code=500, content=_body("internal_error", "Internal server error"))
`),
    draft('app/db/__init__.py', 'Veritabanı paketi', doc('Database package.')),
    draft('app/db/base.py', 'SQLAlchemy bildirim tabanı', String.raw`${doc('Declarative base for ORM models.')}
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
`),
    draft('app/db/session.py', 'Veritabanı bağlantısı, oturum bağımlılığı ve tablo oluşturma', String.raw`${doc('Database engine and session management.')}
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.db.base import Base


def _engine_options(url: str) -> dict:
    if url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    return {"pool_pre_ping": True}


engine = create_engine(settings.database_url, **_engine_options(settings.database_url))
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    import app.models  # noqa: F401  (registers the models on Base.metadata)

    Base.metadata.create_all(bind=engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
`),
    draft('app/models/__init__.py', 'ORM modelleri paketi', 'from app.models.item import Item\n\n__all__ = ["Item"]'),
    draft('app/models/item.py', 'Item veri modeli (SQLAlchemy)', String.raw`${doc('Item ORM model.')}
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Item(Base):
    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
`),
    draft('app/schemas/__init__.py', 'API şemaları paketi', 'from app.schemas.item import ItemCreate, ItemRead\n\n__all__ = ["ItemCreate", "ItemRead"]'),
    draft('app/schemas/item.py', 'Girdi doğrulama ve yanıt şemaları (Pydantic)', String.raw`${doc('Item request and response schemas.')}
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value


class ItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: Optional[str]
    created_at: datetime
`),
    draft('app/services/__init__.py', 'İş mantığı paketi', doc('Business logic.')),
    draft('app/services/item_service.py', 'Parametreli ORM sorgularıyla item iş mantığı', String.raw`${doc('Item business logic using parameterised ORM queries.')}
from typing import List

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.models.item import Item
from app.schemas.item import ItemCreate


def list_items(db: Session, *, limit: int = 50, offset: int = 0) -> List[Item]:
    statement = select(Item).order_by(Item.id).limit(limit).offset(offset)
    return list(db.scalars(statement))


def get_item(db: Session, item_id: int) -> Item:
    item = db.get(Item, item_id)
    if item is None:
        raise NotFoundError(f"Item {item_id} not found")
    return item


def create_item(db: Session, data: ItemCreate) -> Item:
    item = Item(name=data.name, description=data.description)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def delete_item(db: Session, item_id: int) -> None:
    item = get_item(db, item_id)
    db.delete(item)
    db.commit()
`),
    draft('app/api/__init__.py', 'API paketi', doc('HTTP API.')),
    draft('app/api/v1/__init__.py', 'API v1 paketi', doc('API version 1.')),
    draft('app/api/v1/health.py', 'Sağlık kontrolü uç noktası', String.raw`${doc('Health check endpoint.')}
from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "name": settings.app_name}
`),
    draft('app/api/v1/items.py', 'Item CRUD uç noktaları', String.raw`${doc('Item endpoints.')}
from typing import List

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.item import ItemCreate, ItemRead
from app.services import item_service

router = APIRouter(prefix="/items", tags=["items"])


@router.get("", response_model=List[ItemRead])
def list_items(limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    return item_service.list_items(db, limit=limit, offset=offset)


@router.post("", response_model=ItemRead, status_code=status.HTTP_201_CREATED)
def create_item(payload: ItemCreate, db: Session = Depends(get_db)):
    return item_service.create_item(db, payload)


@router.get("/{item_id}", response_model=ItemRead)
def get_item(item_id: int, db: Session = Depends(get_db)):
    return item_service.get_item(db, item_id)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: int, db: Session = Depends(get_db)) -> Response:
    item_service.delete_item(db, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
`),
    draft('app/api/v1/router.py', 'v1 yönlendirici', String.raw`${doc('Aggregated v1 router.')}
from fastapi import APIRouter

from app.api.v1 import health, items

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(items.router)
`),
    draft('tests/__init__.py', 'Test paketi', doc('Tests.')),
    draft('tests/conftest.py', 'Bellek içi veritabanıyla test istemcisi', String.raw`import os

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite://")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (registers the models on Base.metadata)
from app.db.base import Base
from app.db.session import get_db
from app.main import create_app


@pytest.fixture()
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    application = create_app()
    application.dependency_overrides[get_db] = override_get_db
    with TestClient(application) as test_client:
        yield test_client
`),
    draft('tests/test_health.py', 'Sağlık kontrolü testi', 'def test_health(client):\n    response = client.get("/api/v1/health")\n    assert response.status_code == 200\n    assert response.json()["status"] == "ok"\n    assert response.headers["x-request-id"]'),
    draft('tests/test_items.py', 'Item uç noktaları testleri', String.raw`def test_create_and_get_item(client):
    created = client.post("/api/v1/items", json={"name": "  First  ", "description": "demo"})
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "First"

    fetched = client.get(f"/api/v1/items/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["description"] == "demo"
    assert len(client.get("/api/v1/items").json()) == 1


def test_validation_rejects_blank_name(client):
    response = client.post("/api/v1/items", json={"name": "   "})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_missing_item_returns_404(client):
    response = client.get("/api/v1/items/999")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_delete_item(client):
    item_id = client.post("/api/v1/items", json={"name": "temp"}).json()["id"]
    assert client.delete(f"/api/v1/items/{item_id}").status_code == 204
    assert client.get(f"/api/v1/items/{item_id}").status_code == 404
`),
    draft('README.md', 'Kurulum, çalıştırma ve test yönergeleri', readme(context, 'FastAPI + SQLAlchemy + Pydantic', [
      ['Kurulum', '```bash\npython -m venv .venv\n# Windows: .venv\\Scripts\\activate   Linux/macOS: source .venv/bin/activate\npython -m pip install -r requirements.txt\ncp .env.example .env\n```'],
      ['Çalıştırma', '```bash\nuvicorn app.main:app --host 127.0.0.1 --port 8000 --reload\n```\nDokümantasyon: http://127.0.0.1:8000/docs'],
      ['Test', '```bash\npython -m pytest\n```'],
      ['Yapı', '`app/api/v1` uç noktalar, `app/schemas` girdi/çıktı doğrulama, `app/models` ORM modelleri, `app/services` iş mantığı, `app/core` yapılandırma/günlük/hata yönetimi, `app/db` bağlantı.'],
      ['Güvenlik notları', 'Gizli anahtarlar yalnızca ortam değişkenlerinden okunur (`.env.example` örnek verir). CORS yalnızca `CORS_ORIGINS` listesine izin verir, debug varsayılan olarak kapalıdır, sorgular ORM ile parametrelidir.'],
    ])),
  ]
}
