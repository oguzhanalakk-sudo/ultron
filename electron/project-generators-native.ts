// Go (net/http) ve Rust (Axum) için gömülü, çok dosyalı proje üreticileri.
import { draft, markdownText, readme, type DraftFile, type GeneratorContext } from './project-generator-kit.ts'

const gitignore = (extra: string): string => `${extra}\n.env\n.env.*\n!.env.example\n*.log\n.DS_Store`
const TICK = '`'

export function goFiles(context: GeneratorContext): DraftFile[] {
  const module = context.name
  const tag = (value: string): string => `${TICK}json:"${value}"${TICK}`
  return [
    draft('go.mod', 'Go modül tanımı (yalnızca standart kütüphane)', `module ${module}\n\ngo 1.22`),
    draft('.env.example', 'Ortam değişkenleri örneği', 'HOST=127.0.0.1\nPORT=8080\nLOG_LEVEL=info\nALLOWED_ORIGIN=http://localhost:3000'),
    draft('.gitignore', 'Git dışı bırakılacak dosyalar', gitignore('bin/\n*.exe')),
    draft('cmd/server/main.go', 'Sunucu giriş noktası, zaman aşımları ve düzgün kapanış', String.raw`package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"${module}/internal/config"
	"${module}/internal/handler"
	"${module}/internal/logging"
	"${module}/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(2)
	}
	logger := logging.New(cfg.LogLevel)

	server := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           handler.New(logger, store.NewMemory(), cfg.AllowedOrigin),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		logger.Info("server starting", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server failed", "error", err)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}
	logger.Info("server stopped")
}
`),
    draft('internal/config/config.go', 'Ortam değişkenlerinden doğrulanmış yapılandırma', String.raw`package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
)

// Config holds runtime settings loaded from environment variables.
type Config struct {
	Host          string
	Port          int
	LogLevel      string
	AllowedOrigin string
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

// Load reads and validates the configuration.
func Load() (Config, error) {
	port, err := strconv.Atoi(getenv("PORT", "8080"))
	if err != nil || port < 1 || port > 65535 {
		return Config{}, fmt.Errorf("invalid PORT %q", os.Getenv("PORT"))
	}
	return Config{
		Host:          getenv("HOST", "127.0.0.1"),
		Port:          port,
		LogLevel:      getenv("LOG_LEVEL", "info"),
		AllowedOrigin: getenv("ALLOWED_ORIGIN", "http://localhost:3000"),
	}, nil
}

// Addr returns the listen address.
func (c Config) Addr() string {
	return net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
}
`),
    draft('internal/logging/logging.go', 'Yapılandırılmış (JSON) günlük kaydı', String.raw`package logging

import (
	"log/slog"
	"os"
	"strings"
)

// New returns a JSON structured logger for the given level.
func New(level string) *slog.Logger {
	var lvl slog.Level
	if err := lvl.UnmarshalText([]byte(strings.ToUpper(level))); err != nil {
		lvl = slog.LevelInfo
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl}))
}
`),
    draft('internal/store/store.go', 'Eşzamanlılık güvenli item deposu (veritabanı arayüzü)', String.raw`package store

import "sync"

// Item is the domain model.
type Item struct {
	ID          int    ${tag('id')}
	Name        string ${tag('name')}
	Description string ${tag('description,omitempty')}
}

// Store is the persistence contract; replace Memory with a database-backed
// implementation (using parameterised queries) without touching the handlers.
type Store interface {
	Create(name, description string) Item
	List() []Item
	Get(id int) (Item, bool)
}

// Memory is a goroutine-safe in-memory Store.
type Memory struct {
	mu     sync.RWMutex
	nextID int
	items  []Item
}

// NewMemory creates an empty in-memory store.
func NewMemory() *Memory {
	return &Memory{nextID: 1}
}

// Create stores a new item.
func (m *Memory) Create(name, description string) Item {
	m.mu.Lock()
	defer m.mu.Unlock()
	item := Item{ID: m.nextID, Name: name, Description: description}
	m.nextID++
	m.items = append(m.items, item)
	return item
}

// List returns a copy of all items.
func (m *Memory) List() []Item {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return append([]Item(nil), m.items...)
}

// Get returns one item by id.
func (m *Memory) Get(id int) (Item, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, item := range m.items {
		if item.ID == id {
			return item, true
		}
	}
	return Item{}, false
}
`),
    draft('internal/handler/handler.go', 'HTTP yönlendirme, doğrulama, CORS, günlük ve panic kurtarma', String.raw`package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"${module}/internal/store"
)

const maxBodyBytes = 1 << 20

type createRequest struct {
	Name        string ${tag('name')}
	Description string ${tag('description')}
}

type errorBody struct {
	Error struct {
		Code    string ${tag('code')}
		Message string ${tag('message')}
	} ${tag('error')}
}

type api struct {
	logger *slog.Logger
	store  store.Store
}

// New builds the HTTP handler with routing and middleware.
func New(logger *slog.Logger, items store.Store, allowedOrigin string) http.Handler {
	a := &api{logger: logger, store: items}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.health)
	mux.HandleFunc("GET /api/v1/items", a.listItems)
	mux.HandleFunc("POST /api/v1/items", a.createItem)
	mux.HandleFunc("GET /api/v1/items/{id}", a.getItem)
	return a.recoverPanic(a.logRequests(cors(allowedOrigin, mux)))
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var body errorBody
	body.Error.Code = code
	body.Error.Message = message
	writeJSON(w, status, body)
}

func (a *api) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *api) listItems(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, a.store.List())
}

func (a *api) createItem(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var req createRequest
	if err := decoder.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "request body is not valid JSON")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" || len(req.Name) > 120 {
		writeError(w, http.StatusUnprocessableEntity, "validation_error", "name must be between 1 and 120 characters")
		return
	}
	if len(req.Description) > 500 {
		writeError(w, http.StatusUnprocessableEntity, "validation_error", "description must be at most 500 characters")
		return
	}
	writeJSON(w, http.StatusCreated, a.store.Create(req.Name, req.Description))
}

func (a *api) getItem(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_id", "id must be an integer")
		return
	}
	item, ok := a.store.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "item not found")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func cors(allowedOrigin string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" && origin == allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (a *api) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		a.logger.Info("request completed", "method", r.Method, "path", r.URL.Path, "status", recorder.status, "duration_ms", time.Since(started).Milliseconds())
	})
}

func (a *api) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				a.logger.Error("panic recovered", "panic", recovered, "path", r.URL.Path)
				writeError(w, http.StatusInternalServerError, "internal_error", "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
`),
    draft('internal/handler/handler_test.go', 'Uç noktalar için httptest testleri', String.raw`package handler

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"${module}/internal/store"
)

func newServer() http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return New(logger, store.NewMemory(), "http://localhost:3000")
}

func TestHealth(t *testing.T) {
	rec := httptest.NewRecorder()
	newServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestCreateAndGetItem(t *testing.T) {
	server := newServer()
	rec := httptest.NewRecorder()
	server.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/items", strings.NewReader("{\"name\":\" first \"}")))
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	rec = httptest.NewRecorder()
	server.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/items/1", nil))
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "first") {
		t.Fatalf("unexpected response %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRejectsInvalidInput(t *testing.T) {
	rec := httptest.NewRecorder()
	newServer().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/items", strings.NewReader("{\"name\":\"  \"}")))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", rec.Code)
	}
}

func TestUnknownItemIsNotFound(t *testing.T) {
	rec := httptest.NewRecorder()
	newServer().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/items/42", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}
`),
    draft('README.md', 'Kurulum, çalıştırma ve test yönergeleri', readme(context, 'Go (net/http) API', [
      ['Çalıştırma', '```bash\ngo run ./cmd/server\n```'],
      ['Derleme ve test', '```bash\ngo build ./...\ngo test ./...\n```'],
      ['Yapı', '`cmd/server` giriş noktası, `internal/config` yapılandırma, `internal/logging` JSON günlük, `internal/handler` HTTP katmanı, `internal/store` depo arayüzü (bellek içi uygulama; veritabanı için `Store` arayüzünü parametreli sorgularla uygulayın).'],
      ['Ortam değişkenleri', '`.env.example` dosyasına bakın; sunucu varsayılan olarak yalnızca `127.0.0.1` üzerinde dinler.'],
    ])),
  ]
}

export function rustFiles(context: GeneratorContext): DraftFile[] {
  let crate = context.name.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
  if (!crate || /^\d/.test(crate)) crate = `app_${crate}`
  const description = markdownText(context.description, 200).replace(/["\\]/g, '').replace(/\s+/g, ' ')
  return [
    draft('Cargo.toml', 'Rust paket tanımı ve bağımlılıklar', `[package]\nname = "${crate}"\nversion = "0.1.0"\nedition = "2021"\ndescription = "${description}"\n\n[dependencies]\naxum = "0.7"\ntokio = { version = "1", features = ["macros", "rt-multi-thread", "net", "signal"] }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\ntracing = "0.1"\ntracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }`),
    draft('.env.example', 'Ortam değişkenleri örneği', 'HOST=127.0.0.1\nPORT=8000\nRUST_LOG=info'),
    draft('.gitignore', 'Git dışı bırakılacak dosyalar', gitignore('target/')),
    draft('src/main.rs', 'Giriş noktası, günlük kaydı ve düzgün kapanış', String.raw`mod config;
mod error;
mod models;
mod routes;

use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let settings = match config::Config::from_env() {
        Ok(settings) => settings,
        Err(message) => {
            eprintln!("invalid configuration: {message}");
            std::process::exit(2);
        }
    };

    let listener = match tokio::net::TcpListener::bind(settings.addr()).await {
        Ok(listener) => listener,
        Err(err) => {
            tracing::error!(error = %err, "failed to bind listener");
            std::process::exit(1);
        }
    };
    tracing::info!(addr = %settings.addr(), "server starting");

    if let Err(err) = axum::serve(listener, routes::router())
        .with_graceful_shutdown(shutdown_signal())
        .await
    {
        tracing::error!(error = %err, "server failed");
        std::process::exit(1);
    }
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown signal received");
}
`),
    draft('src/config.rs', 'Ortam değişkenlerinden doğrulanmış yapılandırma', String.raw`use std::env;

pub struct Config {
    pub host: String,
    pub port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let port = env::var("PORT")
            .unwrap_or_else(|_| "8000".to_string())
            .parse::<u16>()
            .map_err(|_| "PORT must be a number between 1 and 65535".to_string())?;
        Ok(Self { host, port })
    }

    pub fn addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}
`),
    draft('src/error.rs', 'Tutarlı hata türü ve HTTP yanıtı', String.raw`use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    Validation(String),
    NotFound(String),
    Internal,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            AppError::Validation(message) => (StatusCode::UNPROCESSABLE_ENTITY, "validation_error", message),
            AppError::NotFound(message) => (StatusCode::NOT_FOUND, "not_found", message),
            AppError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error", "internal server error".to_string()),
        };
        (status, Json(json!({ "error": { "code": code, "message": message } }))).into_response()
    }
}
`),
    draft('src/models.rs', 'Veri modelleri ve girdi doğrulama', String.raw`use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
pub struct Item {
    pub id: u64,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct NewItem {
    pub name: String,
    pub description: Option<String>,
}

impl NewItem {
    pub fn validate(&self) -> Result<(), String> {
        let name = self.name.trim();
        if name.is_empty() || name.chars().count() > 120 {
            return Err("name must be between 1 and 120 characters".to_string());
        }
        if self.description.as_ref().map_or(false, |text| text.chars().count() > 500) {
            return Err("description must be at most 500 characters".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::NewItem;

    #[test]
    fn rejects_blank_names() {
        let item = NewItem { name: "   ".to_string(), description: None };
        assert!(item.validate().is_err());
    }

    #[test]
    fn accepts_valid_items() {
        let item = NewItem { name: "first".to_string(), description: Some("demo".to_string()) };
        assert!(item.validate().is_ok());
    }
}
`),
    draft('src/routes.rs', 'Yönlendirme ve uç nokta işleyicileri', String.raw`use std::sync::{Arc, Mutex};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::error::AppError;
use crate::models::{Item, NewItem};

#[derive(Clone, Default)]
struct AppState {
    items: Arc<Mutex<Vec<Item>>>,
}

pub fn router() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/items", get(list_items).post(create_item))
        .route("/api/v1/items/:id", get(get_item))
        .with_state(AppState::default())
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn list_items(State(state): State<AppState>) -> Result<Json<Vec<Item>>, AppError> {
    let items = state.items.lock().map_err(|_| AppError::Internal)?;
    Ok(Json(items.clone()))
}

async fn create_item(State(state): State<AppState>, Json(payload): Json<NewItem>) -> Result<(StatusCode, Json<Item>), AppError> {
    payload.validate().map_err(AppError::Validation)?;
    let mut items = state.items.lock().map_err(|_| AppError::Internal)?;
    let item = Item {
        id: items.len() as u64 + 1,
        name: payload.name.trim().to_string(),
        description: payload.description,
    };
    items.push(item.clone());
    tracing::info!(id = item.id, "item created");
    Ok((StatusCode::CREATED, Json(item)))
}

async fn get_item(State(state): State<AppState>, Path(id): Path<u64>) -> Result<Json<Item>, AppError> {
    let items = state.items.lock().map_err(|_| AppError::Internal)?;
    items
        .iter()
        .find(|item| item.id == id)
        .cloned()
        .map(Json)
        .ok_or_else(|| AppError::NotFound(format!("item {id} not found")))
}
`),
    draft('README.md', 'Kurulum, çalıştırma ve test yönergeleri', readme(context, 'Rust + Axum API', [
      ['Çalıştırma', '```bash\ncargo run\n```'],
      ['Derleme ve test', '```bash\ncargo check\ncargo test\n```'],
      ['Yapı', '`src/main.rs` giriş noktası, `src/config.rs` yapılandırma, `src/routes.rs` uç noktalar, `src/models.rs` modeller ve doğrulama, `src/error.rs` hata yönetimi.'],
      ['Ortam değişkenleri', '`.env.example` dosyasına bakın; sunucu varsayılan olarak yalnızca `127.0.0.1` üzerinde dinler.'],
    ])),
  ]
}
