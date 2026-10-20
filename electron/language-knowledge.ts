import { sanitizeSolutionRecord, type SolutionMemoryFile, type SolutionRecord } from './solution-memory.ts';
import { formatSolutionMemoryForModel, searchSolutionRecords, limitSolutionRecords } from './solution-memory.ts';
import { extractText } from './text-extract.ts';

export interface LanguageInfo {
  name: string;
  extensions: string[];
  category: 'systems' | 'web-frontend' | 'web-backend' | 'mobile' | 'data' | 'scripting' | 'functional' | 'embedded';
  paradigms: string[];
  packageManager?: string;
  buildTools?: string[];
  linters?: string[];
  formatters?: string[];
  testFrameworks?: string[];
  commonPatterns: LanguagePattern[];
  pitfalls: LanguagePitfall[];
  styleGuides: string[];
  documentation: string[];
  standardLibrary: string[];
  ecosystem: string[];
}

export interface LanguagePattern {
  name: string;
  description: string;
  codeExample: string;
  useCase: string;
  antiPattern?: string;
}

export interface LanguagePitfall {
  name: string;
  description: string;
  codeExample: string;
  fix: string;
  severity: 'critical' | 'major' | 'minor';
}

export const LANGUAGE_KNOWLEDGE_BASE: Record<string, LanguageInfo> = {
  typescript: {
    name: 'TypeScript',
    extensions: ['.ts', '.tsx', '.mts', '.cts'],
    category: 'web-frontend',
    paradigms: ['object-oriented', 'functional', 'generic'],
    packageManager: 'npm/pnpm/yarn',
    buildTools: ['tsc', 'esbuild', 'swc', 'vite', 'webpack'],
    linters: ['eslint', 'tsc --noEmit'],
    formatters: ['prettier', 'dprint'],
    testFrameworks: ['vitest', 'jest', 'playwright', 'cypress'],
    commonPatterns: [
      {
        name: 'Discriminated Unions for State',
        description: 'Use discriminated unions instead of enums for type-safe state machines',
        codeExample: `type LoadingState = 
  | { status: 'idle' }
  | { status: 'loading'; progress: number }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

function handleState(state: LoadingState) {
  switch (state.status) {
    case 'loading': return \`Loading \${state.progress}%\`;
    case 'success': return \`Got \${state.data}\`;
    case 'error': return \`Failed: \${state.error.message}\`;
    case 'idle': return 'Ready';
  }
}`,
        useCase: 'API responses, UI state, async workflows',
        antiPattern: 'Using boolean flags like isLoading, isError, data, error separately'
      },
      {
        name: 'Branded Types for IDs',
        description: 'Prevent mixing up different ID types at compile time',
        codeExample: `type Brand<K, T> = K & { __brand: T };
type UserId = Brand<string, 'UserId'>;
type PostId = Brand<string, 'PostId'>;

function getUser(id: UserId) { /* ... */ }
function getPost(id: PostId) { /* ... */ }

// Compile error: getUser(postId)`,
        useCase: 'Database IDs, API keys, entity references',
        antiPattern: 'Using plain strings for all IDs'
      },
      {
        name: 'Utility Types for API Contracts',
        description: 'Derive types from runtime schemas using utility types',
        codeExample: `interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

// Public API type - omit sensitive fields
type PublicUser = Omit<User, 'passwordHash'>;
// Update type - all optional
type UpdateUser = Partial<Pick<User, 'name' | 'email'>>;
// Required for creation
type CreateUser = Pick<User, 'name' | 'email' | 'password'>;`,
        useCase: 'API DTOs, form validation, database operations'
      },
      {
        name: 'Zod for Runtime Validation',
        description: 'Schema validation with automatic TypeScript inference',
        codeExample: `import { z } from 'zod';

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().positive().optional(),
});

type User = z.infer<typeof UserSchema>;

// Validates at runtime, types at compile time
const result = UserSchema.safeParse(input);
if (!result.success) {
  return { errors: result.error.flatten() };
}`,
        useCase: 'API input validation, config parsing, form handling'
      },
      {
        name: 'Async Iterators for Streams',
        description: 'Process large datasets without loading everything into memory',
        codeExample: `async function* fetchAllPages(url: string): AsyncGenerator<Item[]> {
  let cursor: string | undefined;
  do {
    const response = await fetch(\`\${url}\${cursor ? \`?cursor=\${cursor}\` : ''}\`);
    const { items, nextCursor } = await response.json();
    yield items;
    cursor = nextCursor;
  } while (cursor);
}

// Usage - processes one page at a time
for await (const page of fetchAllPages('/api/items')) {
  for (const item of page) process(item);
}`,
        useCase: 'Pagination, large file processing, real-time streams'
      }
    ],
    pitfalls: [
      {
        name: 'any Type Usage',
        description: 'Disables type checking entirely, defeating TypeScript purpose',
        codeExample: `// BAD
function process(data: any) {
  return data.foo.bar.baz; // Runtime error if structure differs
}

// GOOD
function process(data: unknown) {
  if (isValidData(data)) {
    return data.foo.bar.baz; // Type-safe
  }
}`,
        fix: 'Use unknown, type guards, or Zod schemas instead of any',
        severity: 'critical'
      },
      {
        name: 'Non-null Assertion (!) Abuse',
        description: 'Bypasses null checks, causing runtime crashes',
        codeExample: `// BAD
const user = users.find(u => u.id === id)!;
console.log(user.name); // Crash if not found

// GOOD
const user = users.find(u => u.id === id);
if (!user) throw new Error('User not found');
console.log(user.name); // Safe`,
        fix: 'Use proper null checks, optional chaining, or early returns',
        severity: 'major'
      },
      {
        name: 'Interface vs Type Alias Confusion',
        description: 'Interfaces support declaration merging, types don\'t',
        codeExample: `// Interface - can be extended later
interface User {
  name: string;
}
// Later in another file:
interface User {
  email: string; // Merges automatically
}

// Type alias - cannot be merged
type User = { name: string };
// Cannot add email later without redeclaring`,
        fix: 'Use interfaces for public APIs and extensible types',
        severity: 'minor'
      }
    ],
    styleGuides: [
      'https://github.com/typescript-eslint/typescript-eslint',
      'https://google.github.io/styleguide/tsguide.html',
      'https://github.com/airbnb/javascript/tree/master/packages/eslint-config-airbnb-typescript'
    ],
    documentation: [
      'https://www.typescriptlang.org/docs/',
      'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html'
    ],
    standardLibrary: ['Array', 'Map', 'Set', 'Promise', 'JSON', 'Math', 'Date', 'RegExp'],
    ecosystem: ['@types/node', 'tsx', 'ts-node', 'esbuild', 'swc', 'vite']
  },

  python: {
    name: 'Python',
    extensions: ['.py', '.pyi', '.pyw'],
    category: 'data',
    paradigms: ['object-oriented', 'procedural', 'functional'],
    packageManager: 'pip/poetry/uv',
    buildTools: ['setuptools', 'hatch', 'flit', 'poetry'],
    linters: ['ruff', 'pylint', 'mypy', 'pyright'],
    formatters: ['ruff format', 'black', 'isort'],
    testFrameworks: ['pytest', 'unittest', 'hypothesis'],
    commonPatterns: [
      {
        name: 'Dataclasses for Data Objects',
        description: 'Use dataclasses with frozen=True for immutable data',
        codeExample: `from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime

@dataclass(frozen=True, slots=True)
class User:
    id: str
    name: str
    email: str
    created_at: datetime = field(default_factory=datetime.utcnow)
    tags: frozenset[str] = frozenset()

    def with_name(self, name: str) -> 'User':
        return User(id=self.id, name=name, email=self.email, created_at=self.created_at)`,
        useCase: 'DTOs, entities, value objects, configuration'
      },
      {
        name: 'Context Managers for Resources',
        description: 'Ensure cleanup with __enter__/__exit__ or contextlib',
        codeExample: `from contextlib import asynccontextmanager
import aiohttp

@asynccontextmanager
async def http_session():
    async with aiohttp.ClientSession() as session:
        try:
            yield session
        finally:
            await session.close()

# Usage - guaranteed cleanup
async with http_session() as session:
    async with session.get(url) as resp:
        data = await resp.json()`,
        useCase: 'Database connections, HTTP clients, file handles, locks'
      },
      {
        name: 'Type Hints with Protocols',
        description: 'Structural subtyping without inheritance',
        codeExample: `from typing import Protocol, runtime_checkable

@runtime_checkable
class Cache(Protocol):
    async def get(self, key: str) -> str | None: ...
    async def set(self, key: str, value: str, ttl: int) -> None: ...

class RedisCache:
    async def get(self, key: str) -> str | None: ...
    async def set(self, key: str, value: str, ttl: int) -> None: ...

class MemoryCache:
    async def get(self, key: str) -> str | None: ...
    async def set(self, key: str, value: str, ttl: int) -> None: ...

# Both work anywhere Cache is expected
async def warm_cache(cache: Cache, keys: list[str]) -> None: ...`,
        useCase: 'Dependency injection, testing with mocks, plugin systems'
      },
      {
        name: 'Pathlib for File Operations',
        description: 'Object-oriented filesystem paths, cross-platform',
        codeExample: `from pathlib import Path

def find_config_files(root: Path) -> list[Path]:
    return list(root.rglob('*.toml')) + list(root.rglob('*.yaml'))

def atomic_write(path: Path, content: str) -> None:
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(content, encoding='utf-8')
    temp.replace(path)  # Atomic on POSIX, best-effort on Windows

# Usage
config_dir = Path.home() / '.config' / 'myapp'
config_dir.mkdir(parents=True, exist_ok=True)
atomic_write(config_dir / 'settings.json', '{}')`,
        useCase: 'Config files, data processing, CLI tools'
      }
    ],
    pitfalls: [
      {
        name: 'Mutable Default Arguments',
        description: 'Default arguments evaluated once at function definition',
        codeExample: `# BAD
def add_item(item, items=[]):
    items.append(item)
    return items

add_item(1)  # [1]
add_item(2)  # [1, 2] - BUG!

# GOOD
def add_item(item, items=None):
    if items is None:
        items = []
    items.append(item)
    return items`,
        fix: 'Use None as default and create mutable inside function',
        severity: 'critical'
      },
      {
        name: 'Late Binding in Closures',
        description: 'Loop variables captured by reference, not value',
        codeExample: `# BAD
funcs = []
for i in range(3):
    funcs.append(lambda: i)  # All return 2!

# GOOD
funcs = []
for i in range(3):
    funcs.append(lambda i=i: i)  # Capture current value
# Or use functools.partial`,
        fix: 'Use default arguments or functools.partial to capture loop variables',
        severity: 'major'
      },
      {
        name: 'String Concatenation in Loops',
        description: 'Strings are immutable, creates O(n²) allocations',
        codeExample: `# BAD
result = ''
for item in items:
    result += str(item)  # New string each iteration

# GOOD
result = ''.join(str(item) for item in items)
# Or use io.StringIO for complex cases`,
        fix: 'Use str.join() or list comprehension with join',
        severity: 'major'
      }
    ],
    styleGuides: [
      'https://peps.python.org/pep-0008/',
      'https://github.com/google/styleguide/blob/gh-pages/pyguide.md'
    ],
    documentation: [
      'https://docs.python.org/3/',
      'https://realpython.com/'
    ],
    standardLibrary: ['pathlib', 'dataclasses', 'asyncio', 'contextlib', 'itertools', 'functools', 'collections', 'typing'],
    ecosystem: ['uv', 'ruff', 'pytest', 'pydantic', 'httpx', 'sqlalchemy', 'polars', 'numpy']
  },

  rust: {
    name: 'Rust',
    extensions: ['.rs'],
    category: 'systems',
    paradigms: ['functional', 'imperative', 'concurrent'],
    packageManager: 'cargo',
    buildTools: ['cargo', 'rustc'],
    linters: ['clippy', 'rustfmt', 'rust-analyzer'],
    formatters: ['rustfmt'],
    testFrameworks: ['built-in', 'proptest', 'quickcheck'],
    commonPatterns: [
      {
        name: 'Result<T, E> for Error Handling',
        description: 'Explicit error handling without exceptions',
        codeExample: `use std::fs;
use std::io;

fn read_config(path: &str) -> Result<String, io::Error> {
    fs::read_to_string(path)
        .map_err(|e| io::Error::new(e.kind(), format!("Config read failed: {}", e)))
}

fn main() {
    match read_config("config.toml") {
        Ok(config) => println!("Config: {}", config),
        Err(e) => eprintln!("Error: {}", e),
    }
}

// ? operator for propagation
fn process() -> Result<(), MyError> {
    let config = read_config("config.toml")?;
    let data = parse(&config)?;
    save(data)?;
    Ok(())
}`,
        useCase: 'All fallible operations, I/O, parsing, network'
      },
      {
        name: 'Option<T> for Nullable Values',
        description: 'Explicit handling of absent values',
        codeExample: `fn find_user(id: u64) -> Option<User> {
    users.get(&id).cloned()
}

fn greet_user(id: u64) {
    match find_user(id) {
        Some(user) => println!("Hello, {}!", user.name),
        None => println!("User not found"),
    }
}

// Combinators for chaining
fn get_user_email(id: u64) -> Option<String> {
    find_user(id)
        .and_then(|u| u.email.clone())
        .map(|e| e.to_lowercase())
}`,
        useCase: 'Database lookups, config options, optional fields'
      },
      {
        name: 'Traits for Polymorphism',
        description: 'Define shared behavior without inheritance',
        codeExample: `trait Storage {
    async fn save(&self, key: &str, data: &[u8]) -> Result<(), Error>;
    async fn load(&self, key: &str) -> Result<Vec<u8>, Error>;
}

struct S3Storage { bucket: String }
impl Storage for S3Storage {
    async fn save(&self, key: &str, data: &[u8]) -> Result<(), Error> { ... }
    async fn load(&self, key: &str) -> Result<Vec<u8>, Error> { ... }
}

struct LocalStorage { path: PathBuf }
impl Storage for LocalStorage {
    async fn save(&self, key: &str, data: &[u8]) -> Result<(), Error> { ... }
    async fn load(&self, key: &str) -> Result<Vec<u8>, Error> { ... }
}

// Generic function works with any Storage
async fn backup<S: Storage>(storage: &S, items: &[Item]) -> Result<(), Error> { ... }`,
        useCase: 'Database drivers, cloud providers, plugin systems'
      },
      {
        name: 'Builder Pattern with Type State',
        description: 'Enforce required fields at compile time',
        codeExample: `struct HttpRequestBuilder<State> {
    url: String,
    method: Option<String>,
    headers: HashMap<String, String>,
    body: Option<Vec<u8>>,
    _state: std::marker::PhantomData<State>,
}

struct HasUrl;
struct HasMethod;
struct Ready;

impl HttpRequestBuilder<HasUrl> {
    fn method(mut self, method: impl Into<String>) -> HttpRequestBuilder<HasMethod> {
        self.method = Some(method.into());
        HttpRequestBuilder { method: self.method, ..self }
    }
}

impl HttpRequestBuilder<HasMethod> {
    fn header(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.headers.insert(key.into(), value.into());
        self
    }
    fn body(mut self, body: Vec<u8>) -> HttpRequestBuilder<Ready> {
        self.body = Some(body);
        HttpRequestBuilder { body: self.body, ..self }
    }
}

impl HttpRequestBuilder<Ready> {
    async fn send(self) -> Result<Response, Error> { ... }
}

// Usage - won't compile if method/url missing
let response = HttpRequestBuilder::new("https://api.example.com")
    .method("POST")
    .header("Content-Type", "application/json")
    .body(b"{}".to_vec())
    .send()
    .await?;`,
        useCase: 'API clients, configuration builders, complex object construction'
      }
    ],
    pitfalls: [
      {
        name: 'Clone() Overuse',
        description: 'Unnecessary allocations, defeats ownership model',
        codeExample: `# BAD
fn process(items: Vec<String>) {
    for item in items.clone() {  // Allocates copy
        println!("{}", item);
    }
}

# GOOD
fn process(items: &Vec<String>) {  // Borrow
    for item in items {
        println!("{}", item);
    }
}

// Or consume if ownership needed
fn consume(items: Vec<String>) {  // Take ownership
    for item in items { ... }
}`,
        fix: 'Prefer references (&T, &mut T) over owned values; use iterators',
        severity: 'major'
      },
      {
        name: 'Unwrap() in Production',
        description: 'Panics on None/Err, crashes the program',
        codeExample: `# BAD
let config = fs::read_to_string("config.toml").unwrap();  // Panic if missing

# GOOD
let config = fs::read_to_string("config.toml")
    .map_err(|e| AppError::ConfigMissing(e))?;

// Or with defaults
let config = fs::read_to_string("config.toml")
    .unwrap_or_else(|_| default_config())`,
        fix: 'Use ?, unwrap_or, unwrap_or_else, or proper error handling',
        severity: 'critical'
      }
    ],
    styleGuides: [
      'https://rust-lang.github.io/api-guidelines/',
      'https://doc.rust-lang.org/1.0.0/style/'
    ],
    documentation: [
      'https://doc.rust-lang.org/book/',
      'https://doc.rust-lang.org/std/'
    ],
    standardLibrary: ['std::collections', 'std::sync', 'std::fs', 'std::io', 'std::net'],
    ecosystem: ['tokio', 'serde', 'clap', 'anyhow', 'thiserror', 'sqlx', 'reqwest']
  },

  go: {
    name: 'Go',
    extensions: ['.go'],
    category: 'web-backend',
    paradigms: ['imperative', 'concurrent'],
    packageManager: 'go modules',
    buildTools: ['go build', 'go test'],
    linters: ['golangci-lint', 'staticcheck', 'go vet'],
    formatters: ['gofmt', 'goimports'],
    testFrameworks: ['testing', 'testify', 'ginkgo'],
    commonPatterns: [
      {
        name: 'Error as Values',
        description: 'Explicit error handling with multiple return values',
        codeExample: `func readConfig(path string) (string, error) {
    data, err := os.ReadFile(path)
    if err != nil {
        return "", fmt.Errorf("read config: %w", err)
    }
    return string(data), nil
}

func process() error {
    config, err := readConfig("config.toml")
    if err != nil {
        return fmt.Errorf("process: %w", err)
    }
    return doWork(config)
}

// Custom error types
type ConfigError struct {
    Path string
    Err  error
}

func (e *ConfigError) Error() string {
    return fmt.Sprintf("config %s: %v", e.Path, e.Err)
}

func (e *ConfigError) Unwrap() error { return e.Err }`,
        useCase: 'All functions that can fail, I/O, parsing, network'
      },
      {
        name: 'Interfaces for Decoupling',
        description: 'Implicit interfaces for testability and flexibility',
        codeExample: `type UserStore interface {
    Get(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, u *User) error
}

type PostgresStore struct { db *sql.DB }
func (s *PostgresStore) Get(ctx context.Context, id string) (*User, error) { ... }
func (s *PostgresStore) Save(ctx context.Context, u *User) error { ... }

type MemoryStore struct { mu sync.Mutex; users map[string]*User }
func (s *MemoryStore) Get(ctx context.Context, id string) (*User, error) { ... }
func (s *MemoryStore) Save(ctx context.Context, u *User) error { ... }

// Function accepts any implementation
func GetUser(ctx context.Context, store UserStore, id string) (*User, error) {
    return store.Get(ctx, id)
}`,
        useCase: 'Database drivers, external APIs, plugin systems, testing'
      },
      {
        name: 'Context for Cancellation',
        description: 'Propagate deadlines and cancellation signals',
        codeExample: `func fetchWithTimeout(ctx context.Context, urls []string) ([]Response, error) {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()

    type result struct {
        idx int
        resp *http.Response
        err error
    }
    results := make(chan result, len(urls))

    for i, url := range urls {
        go func(i int, url string) {
            req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
            resp, err := http.DefaultClient.Do(req)
            results <- result{i, resp, err}
        }(i, url)
    }

    var responses []Response
    for range urls {
        r := <-results
        if r.err != nil {
            return nil, r.err
        }
        responses = append(responses, Response{...})
    }
    return responses, nil
}`,
        useCase: 'HTTP requests, database queries, long-running operations'
      },
      {
        name: 'Generics for Reusable Code',
        description: 'Type-safe generic functions and types (Go 1.18+)',
        codeExample: `func Map[T, U any](slice []T, fn func(T) U) []U {
    result := make([]U, len(slice))
    for i, v := range slice {
        result[i] = fn(v)
    }
    return result
}

func Filter[T any](slice []T, fn func(T) bool) []T {
    var result []T
    for _, v := range slice {
        if fn(v) {
            result = append(result, v)
        }
    }
    return result
}

// Usage
numbers := []int{1, 2, 3, 4, 5}
doubled := Map(numbers, func(n int) int { return n * 2 })
evens := Filter(numbers, func(n int) bool { return n%2 == 0 })`,
        useCase: 'Collection operations, middleware, data transformation'
      }
    ],
    pitfalls: [
      {
        name: 'Ignoring Errors',
        description: 'Discarding error return values silently',
        codeExample: `# BAD
json.Unmarshal(data, &target)  // Error ignored!

# GOOD
if err := json.Unmarshal(data, &target); err != nil {
    return fmt.Errorf("unmarshal: %w", err)
}

// Or explicitly discard
_ = json.Unmarshal(data, &target)  // Intentional discard`,
        fix: 'Always check or explicitly discard errors',
        severity: 'critical'
      },
      {
        name: 'Goroutine Loop Variable Capture',
        description: 'Loop variable shared across goroutines',
        codeExample: `# BAD
for i := 0; i < 3; i++ {
    go func() { fmt.Println(i) }()  // Prints 3, 3, 3
}

# GOOD
for i := 0; i < 3; i++ {
    i := i  // Shadow creates new variable
    go func() { fmt.Println(i) }()
}

// Or pass as argument
for i := 0; i < 3; i++ {
    go func(i int) { fmt.Println(i) }(i)
}`,
        fix: 'Shadow loop variable or pass as argument',
        severity: 'critical'
      }
    ],
    styleGuides: [
      'https://github.com/golang/go/wiki/CodeReviewComments',
      'https://google.github.io/styleguide/go/'
    ],
    documentation: [
      'https://go.dev/doc/',
      'https://golang.org/doc/effective_go.html'
    ],
    standardLibrary: ['context', 'net/http', 'encoding/json', 'sync', 'time', 'io', 'os', 'fmt'],
    ecosystem: ['gin', 'chi', 'gorm', 'sqlc', 'go-kit', 'uber-go/zap', 'prometheus/client_golang']
  },

  javascript: {
    name: 'JavaScript (Node.js)',
    extensions: ['.js', '.mjs', '.cjs'],
    category: 'web-backend',
    paradigms: ['event-driven', 'functional', 'prototype-based'],
    packageManager: 'npm/pnpm/yarn',
    buildTools: ['esbuild', 'swc', 'vite', 'webpack', 'rollup'],
    linters: ['eslint', 'standard'],
    formatters: ['prettier', 'dprint'],
    testFrameworks: ['vitest', 'jest', 'mocha', 'playwright'],
    commonPatterns: [
      {
        name: 'ES Modules with Top-level Await',
        description: 'Native modules with async initialization',
        codeExample: `// config.js - runs once at import
const config = await loadConfig();
export const api = createClient(config);

// main.js - imports are async
import { api } from './config.js';
const user = await api.getUser();`,
        useCase: 'Config loading, DB connections, API clients'
      },
      {
        name: 'Functional Array Methods',
        description: 'Chain operations without mutation',
        codeExample: `const users = await fetchUsers();

const activeAdmins = users
  .filter(u => u.active && u.role === 'admin')
  .map(u => ({ id: u.id, name: u.name, permissions: u.perms }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Reduce for aggregation
const stats = users.reduce((acc, u) => {
  acc.byRole[u.role] = (acc.byRole[u.role] || 0) + 1;
  return acc;
}, { byRole: {} });`,
        useCase: 'Data transformation, filtering, aggregation'
      },
      {
        name: 'Async Iterators & Generators',
        description: 'Memory-efficient stream processing',
        codeExample: `async function* fetchBatches(url) {
  let cursor = null;
  do {
    const res = await fetch(cursor ? \`\${url}?cursor=\${cursor}\` : url);
    const { items, nextCursor } = await res.json();
    yield items;
    cursor = nextCursor;
  } while (cursor);
}

// Process without loading all
for await (const batch of fetchBatches('/api/items')) {
  await processBatch(batch);
}`,
        useCase: 'Pagination, large datasets, real-time streams'
      }
    ],
    pitfalls: [
      {
        name: 'Callback Hell / Promise Chaining',
        description: 'Nested callbacks hard to read and debug',
        codeExample: `# BAD
getData((err, data) => {
  process(data, (err, result) => {
    save(result, (err) => { ... });
  });
});

// GOOD - async/await
const data = await getData();
const result = await process(data);
await save(result);

// Or Promise.all for parallelism
const [users, posts] = await Promise.all([
  fetchUsers(),
  fetchPosts()
]);`,
        fix: 'Use async/await, Promise.all, Promise.allSettled',
        severity: 'major'
      },
      {
        name: 'Event Loop Blocking',
        description: 'Synchronous operations block the event loop',
        codeExample: `# BAD
const data = fs.readFileSync('large.json');  // Blocks!
const parsed = JSON.parse(data);  // Blocks!

# GOOD
const data = await fs.promises.readFile('large.json');
const parsed = JSON.parse(data);  // Still blocks but async I/O

# For CPU-intensive: use worker_threads
const { Worker } = require('worker_threads');`,
        fix: 'Use async I/O, worker_threads for CPU work, avoid sync APIs',
        severity: 'major'
      }
    ],
    styleGuides: [
      'https://standardjs.com/',
      'https://github.com/airbnb/javascript'
    ],
    documentation: [
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
      'https://nodejs.org/en/docs/'
    ],
    standardLibrary: ['Promise', 'Array', 'Map', 'Set', 'Object', 'JSON', 'fetch'],
    ecosystem: ['express', 'fastify', 'socket.io', 'prisma', 'zod', 'vitest']
  },

  csharp: {
    name: 'C# / .NET',
    extensions: ['.cs'],
    category: 'web-backend',
    paradigms: ['object-oriented', 'functional', 'generic'],
    packageManager: 'NuGet',
    buildTools: ['dotnet build', 'msbuild'],
    linters: ['Roslyn analyzers', 'SonarAnalyzer', 'StyleCop'],
    formatters: ['dotnet format', 'csharpier'],
    testFrameworks: ['xUnit', 'NUnit', 'MSTest', 'FluentAssertions'],
    commonPatterns: [
      {
        name: 'Records for Immutable Data',
        description: 'Concise immutable types with value equality (C# 9+)',
        codeExample: `public record User(
    Guid Id,
    string Name,
    string Email,
    DateTime CreatedAt,
    IReadOnlyList<string> Tags
) {
    public User WithName(string name) => this with { Name = name };
}

// Positional records for DTOs
public record CreateUserRequest(string Name, string Email);
public record UserResponse(Guid Id, string Name, string Email);`,
        useCase: 'DTOs, entities, commands, events, API contracts'
      },
      {
        name: 'Pattern Matching',
        description: 'Exhaustive matching on types and values',
        codeExample: `public string Describe(object obj) => obj switch {
    User u when u.Tags.Contains("admin") => $"Admin: {u.Name}",
    User u => $"User: {u.Name}",
    null => "Unknown",
    _ => obj.ToString()
};

// Property patterns
public bool IsValid(CreateUserRequest req) => req switch {
    { Name.Length: > 0, Email: { Length: > 5 } } => true,
    _ => false
};`,
        useCase: 'Validation, state machines, command handling'
      },
      {
        name: 'Result Pattern',
        description: 'Functional error handling without exceptions',
        codeExample: `public abstract record Result<T> {
    public sealed record Ok(T Value) : Result<T>;
    public sealed record Error(string Message, Exception? Ex = null) : Result<T>;
}

public static Result<User> GetUser(Guid id) {
    var user = _db.Users.Find(id);
    return user is null 
        ? new Result<User>.Error("User not found")
        : new Result<User>.Ok(user);
}

// Usage
var result = GetUser(id);
return result switch {
    Result<User>.Ok(var user) => Ok(user),
    Result<User>.Error(var err) => NotFound(err.Message)
};`,
        useCase: 'Service layer, repository methods, API endpoints'
      },
      {
        name: 'Dependency Injection with Scoped Services',
        description: 'Built-in DI container with lifetime management',
        codeExample: `// Program.cs
builder.Services.AddScoped<IUserRepository, SqlUserRepository>();
builder.Services.AddScoped<UserService>();
builder.Services.AddTransient<IEmailSender, SmtpEmailSender>();
builder.Services.AddSingleton<ICache, RedisCache>();

// Constructor injection
public class UserService(
    IUserRepository repo,
    IEmailSender email,
    ICache cache,
    ILogger<UserService> logger) { ... }`,
        useCase: 'Application services, controllers, background workers'
      }
    ],
    pitfalls: [
      {
        name: 'Null Reference Exceptions',
        description: 'Reference types can be null by default',
        codeExample: `# BAD
public string GetName(User user) => user.Name;  // NRE if user null

# GOOD - Nullable reference types (enable in .csproj)
# <Nullable>enable</Nullable>
public string? GetName(User? user) => user?.Name;

# Or with validation
public string GetName(User user) {
    ArgumentNullException.ThrowIfNull(user);
    return user.Name;
}`,
        fix: 'Enable nullable reference types, use ? annotations, validate inputs',
        severity: 'critical'
      },
      {
        name: 'Async Void Methods',
        description: 'Fire-and-forget exceptions crash the process',
        codeExample: `# BAD
public async void OnButtonClick() {
    await SaveData();  // Exception lost!
}

# GOOD
public async Task OnButtonClick() {
    try { await SaveData(); }
    catch (Exception ex) { logger.LogError(ex, "Save failed"); }
}`,
        fix: 'Use async Task instead of async void, always await',
        severity: 'critical'
      }
    ],
    styleGuides: [
      'https://docs.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions',
      'https://github.com/dotnet/runtime/blob/main/docs/coding-guidelines/coding-style.md'
    ],
    documentation: [
      'https://learn.microsoft.com/en-us/dotnet/csharp/',
      'https://github.com/dotnet/docs'
    ],
    standardLibrary: ['System.Collections.Generic', 'System.Linq', 'System.Threading.Tasks', 'System.Text.Json'],
    ecosystem: ['Entity Framework Core', 'ASP.NET Core', 'MediatR', 'FluentValidation', 'AutoMapper', 'Serilog']
  },

  java: {
    name: 'Java',
    extensions: ['.java'],
    category: 'web-backend',
    paradigms: ['object-oriented', 'imperative'],
    packageManager: 'Maven/Gradle',
    buildTools: ['maven', 'gradle'],
    linters: ['Checkstyle', 'PMD', 'SpotBugs', 'Error Prone'],
    formatters: ['google-java-format', 'Spotless'],
    testFrameworks: ['JUnit 5', 'TestNG', 'AssertJ', 'Mockito'],
    commonPatterns: [
      {
        name: 'Records for Immutable Data (Java 16+)',
        description: 'Concise data carriers with automatic equals/hashCode/toString',
        codeExample: `public record User(
    UUID id,
    String name,
    String email,
    Instant createdAt,
    Set<String> tags
) {
    // Compact constructor for validation
    public User {
        Objects.requireNonNull(name);
        Objects.requireNonNull(email);
    }
    
    public User withName(String name) {
        return new User(id, name, email, createdAt, tags);
    }
}`,
        useCase: 'DTOs, entities, value objects, events'
      },
      {
        name: 'Sealed Classes for Algebraic Data Types (Java 17+)',
        description: 'Restricted hierarchies for exhaustive pattern matching',
        codeExample: `public sealed interface Result<T> 
    permits Result.Success, Result.Error {
    
    record Success<T>(T value) implements Result<T> {}
    record Error<T>(String message, Throwable cause) implements Result<T> {}
}

public static <T> String describe(Result<T> result) {
    return switch (result) {
        case Success<T>(var value) -> "OK: " + value;
        case Error<T>(var msg, var cause) -> "Error: " + msg;
    };
}`,
        useCase: 'State machines, error handling, commands'
      },
      {
        name: 'Stream API for Collection Processing',
        description: 'Functional operations on collections',
        codeExample: `List<User> activeAdmins = users.stream()
    .filter(u -> u.isActive() && u.hasRole("ADMIN"))
    .sorted(Comparator.comparing(User::getName))
    .collect(Collectors.toUnmodifiableList());

// Parallel streams for CPU-intensive work
Map<String, Long> roleCounts = users.parallelStream()
    .collect(Collectors.groupingBy(User::getRole, Collectors.counting()));`,
        useCase: 'Data transformation, filtering, aggregation'
      }
    ],
    pitfalls: [
      {
        name: 'Null Pointer Exceptions',
        description: 'Every reference can be null',
        codeExample: `# BAD
public String getName(User user) { return user.getName(); }

# GOOD
@NotNull
public String getName(@NotNull User user) { return user.getName(); }

// Or with Optional
public Optional<String> getName(User user) {
    return Optional.ofNullable(user).map(User::getName);
}`,
        fix: 'Use @NotNull/@Nullable, Optional, or Objects.requireNonNull',
        severity: 'critical'
      }
    ],
    styleGuides: [
      'https://google.github.io/styleguide/javaguide.html'
    ],
    documentation: [
      'https://docs.oracle.com/en/java/',
      'https://docs.spring.io/spring-framework/docs/current/reference/html/'
    ],
    standardLibrary: ['java.util', 'java.time', 'java.nio', 'java.util.stream', 'java.util.concurrent'],
    ecosystem: ['Spring Boot', 'Quarkus', 'Micronaut', 'Hibernate', 'MapStruct', 'Testcontainers']
  },
  cpp: {
    name: 'C++',
    extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.h'],
    category: 'systems',
    paradigms: ['procedural', 'object-oriented', 'generic', 'functional'],
    packageManager: 'vcpkg/conan',
    buildTools: ['cmake', 'ninja', 'msbuild', 'clang++', 'g++'],
    linters: ['clang-tidy', 'cppcheck'],
    formatters: ['clang-format'],
    testFrameworks: ['GoogleTest', 'Catch2', 'doctest'],
    commonPatterns: [
      {
        name: 'RAII and Smart Pointers',
        description: 'Bind resource lifetime to object lifetime; prefer unique_ptr/shared_ptr over raw new/delete',
        codeExample: `#include <memory>
#include <vector>

class FileHandle {
  std::unique_ptr<FILE, decltype(&fclose)> handle;
public:
  explicit FileHandle(const char* path) : handle(std::fopen(path, "rb"), &fclose) {}
  bool valid() const { return handle != nullptr; }
};

void process(const std::vector<int>& values) {
  auto copy = std::make_unique<std::vector<int>>(values);
  // no manual delete needed
}`,
        useCase: 'File handles, sockets, memory ownership, exception-safe cleanup',
        antiPattern: 'Manual new/delete pairs that leak on early return or exception'
      },
      {
        name: 'const-correct Interfaces',
        description: 'Mark read-only parameters and methods const so the compiler enforces intent',
        codeExample: `struct User {
  std::string name;
  std::string email;
};

std::string displayName(const User& user) { return user.name; }

class Repo {
public:
  std::vector<User> list() const; // does not mutate
};`,
        useCase: 'API design, avoiding accidental mutation and copies'
      }
    ],
    pitfalls: [
      {
        name: 'Dangling References and Use-After-Free',
        description: 'References/pointers to destroyed temporaries or freed storage cause undefined behavior',
        codeExample: `const std::string& bad() { return std::string("temp"); } // dangling

int* p = new int(5);
delete p;
*p = 10; // use-after-free`,
        fix: 'Return by value, use smart pointers, run with AddressSanitizer and clang-tidy checks',
        severity: 'critical'
      },
      {
        name: 'Signed/Unsigned Comparison Bugs',
        description: 'size_t is unsigned; comparing with signed int converts to unsigned and hides negative values',
        codeExample: `int n = -1;
std::vector<int> v{1, 2, 3};
if (n < v.size()) { /* true because -1 converts to huge size_t */ }`,
        fix: 'Use the same type on both sides, prefer std::ssize(v) or validate before casting',
        severity: 'major'
      }
    ],
    styleGuides: ['https://google.github.io/styleguide/cppguide.html', 'https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines'],
    documentation: ['https://en.cppreference.com/', 'https://isocpp.org/'],
    standardLibrary: ['std::vector', 'std::string', 'std::string_view', 'std::unique_ptr', 'std::shared_ptr', 'std::algorithm', 'std::filesystem', 'std::optional'],
    ecosystem: ['Boost', 'fmt', 'spdlog', 'nlohmann/json', 'Abseil', 'Qt', 'SDL2']
  },
  ruby: {
    name: 'Ruby',
    extensions: ['.rb', '.rake', '.gemspec'],
    category: 'scripting',
    paradigms: ['object-oriented', 'functional', 'metaprogramming'],
    packageManager: 'bundler/gem',
    buildTools: ['rake', 'bundler'],
    linters: ['rubocop'],
    formatters: ['rubocop -a'],
    testFrameworks: ['rspec', 'minitest'],
    commonPatterns: [
      {
        name: 'Enumerable Pipelines',
        description: 'Transform collections with map/select/reduce instead of manual loops',
        codeExample: `users = [{ name: "Ada", active: true }, { name: "Bob", active: false }]
active_names = users.select { |u| u[:active] }.map { |u| u[:name] }
total = users.reduce(0) { |sum, u| sum + (u[:active] ? 1 : 0) }`,
        useCase: 'Data filtering and aggregation that reads like prose',
        antiPattern: 'Building arrays in a for loop with conditional push calls'
      },
      {
        name: 'Modules as Mixins',
        description: 'Share behavior through modules instead of deep inheritance',
        codeExample: `module Timestampable
  def touch
    @updated_at = Time.now
  end
end

class Document
  include Timestampable
end`,
        useCase: 'Cross-cutting behavior shared by unrelated classes'
      }
    ],
    pitfalls: [
      {
        name: 'NoMethodError on nil',
        description: 'Calling a method on nil raises NoMethodError; safe navigation is required',
        codeExample: `# BAD
user.address.city

# GOOD
user&.address&.city
user.address&.city`,
        fix: 'Use safe navigation, default values, or validate presence at the boundary',
        severity: 'major'
      }
    ],
    styleGuides: ['https://rubystyle.guide/', 'https://github.com/rubocop/ruby-style-guide'],
    documentation: ['https://ruby-doc.org/', 'https://guides.rubyonrails.org/'],
    standardLibrary: ['Enumerable', 'File', 'JSON', 'Net::HTTP', 'Pathname', 'Time'],
    ecosystem: ['Ruby on Rails', 'Sinatra', 'Sidekiq', 'RSpec', 'Sequel', 'Devise']
  },
  php: {
    name: 'PHP',
    extensions: ['.php', '.phtml'],
    category: 'web-backend',
    paradigms: ['object-oriented', 'procedural', 'functional'],
    packageManager: 'composer',
    buildTools: ['composer', 'phpunit'],
    linters: ['phpstan', 'psalm', 'phpcs'],
    formatters: ['php-cs-fixer', 'pint'],
    testFrameworks: ['phpunit', 'pest'],
    commonPatterns: [
      {
        name: 'Strict Types and Typed Properties',
        description: 'Declare strict_types and use typed properties/parameters to fail fast',
        codeExample: `<?php
declare(strict_types=1);

final class User {
    public function __construct(
        public readonly string $name,
        public readonly string $email,
    ) {}
}

function greet(User $user): string {
    return "Merhaba " . $user->name;
}`,
        useCase: 'Domain models and service boundaries',
        antiPattern: 'Untyped arrays passed through many layers with implicit coercion'
      },
      {
        name: 'Prepared Statements with PDO',
        description: 'Always bind parameters instead of interpolating values into SQL',
        codeExample: `<?php
$stmt = $pdo->prepare('SELECT id, email FROM users WHERE email = :email');
$stmt->execute(['email' => $email]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);`,
        useCase: 'Any database query that includes user input'
      }
    ],
    pitfalls: [
      {
        name: 'Loose Comparison Type Juggling',
        description: 'The == operator coerces types and can make different values equal',
        codeExample: `<?php
var_dump("0" == false);  // true
var_dump("1" == "01");   // true
var_dump(100 == "1e2");  // true

var_dump("0" === false); // false`,
        fix: 'Use === and !== everywhere; enable strict_types; validate input types',
        severity: 'major'
      }
    ],
    styleGuides: ['https://www.php-fig.org/psr/psr-12/'],
    documentation: ['https://www.php.net/manual/en/', 'https://getcomposer.org/doc/'],
    standardLibrary: ['PDO', 'mbstring', 'array functions', 'DateTimeImmutable', 'JsonException', 'file functions'],
    ecosystem: ['Laravel', 'Symfony', 'Doctrine', 'PHPUnit', 'Pest', 'WordPress']
  },
  swift: {
    name: 'Swift',
    extensions: ['.swift'],
    category: 'mobile',
    paradigms: ['object-oriented', 'protocol-oriented', 'functional'],
    packageManager: 'SwiftPM/CocoaPods',
    buildTools: ['swift build', 'xcodebuild'],
    linters: ['swiftlint'],
    formatters: ['swiftformat'],
    testFrameworks: ['XCTest', 'swift-testing'],
    commonPatterns: [
      {
        name: 'guard let for Early Exit',
        description: 'Unwrap optionals and fail fast instead of nesting if let blocks',
        codeExample: `func displayName(user: User?) -> String {
    guard let user, let name = user.name, !name.isEmpty else {
        return "Anonim"
    }
    return name
}`,
        useCase: 'Input validation and optional unwrapping at function boundaries',
        antiPattern: 'Deeply nested if let pyramids or forced unwraps'
      },
      {
        name: 'Protocol-Oriented Abstraction',
        description: 'Define capabilities as protocols and compose instead of subclassing',
        codeExample: `protocol Persistable {
    func save() async throws
}

struct Note: Persistable {
    let id: UUID
    let title: String
    func save() async throws { /* ... */ }
}`,
        useCase: 'Testable services and dependency injection'
      }
    ],
    pitfalls: [
      {
        name: 'Force Unwrapping Crashes',
        description: 'Using ! on nil optionals crashes the app at runtime',
        codeExample: `// BAD
let name = user.name!

// GOOD
guard let name = user.name else { return }`,
        fix: 'Use guard let/if let, nil-coalescing, or validate before unwrapping',
        severity: 'critical'
      },
      {
        name: 'Retain Cycles in Closures',
        description: 'Closures capturing self strongly can keep objects alive forever',
        codeExample: `// BAD
service.onComplete = { self.reload() }

// GOOD
service.onComplete = { [weak self] in self?.reload() }`,
        fix: 'Capture self weakly in escaping closures and break delegate cycles',
        severity: 'major'
      }
    ],
    styleGuides: ['https://www.swift.org/documentation/api-design-guidelines/'],
    documentation: ['https://www.swift.org/documentation/', 'https://developer.apple.com/documentation/'],
    standardLibrary: ['Foundation', 'SwiftUI', 'Combine', 'async/await', 'Codable'],
    ecosystem: ['Alamofire', 'Kingfisher', 'Realm', 'Vapor', 'SwiftData']
  },
  kotlin: {
    name: 'Kotlin',
    extensions: ['.kt', '.kts'],
    category: 'mobile',
    paradigms: ['object-oriented', 'functional', 'coroutines'],
    packageManager: 'Gradle/Maven',
    buildTools: ['gradle', 'kotlinc'],
    linters: ['detekt', 'ktlint'],
    formatters: ['ktfmt', 'ktlint -F'],
    testFrameworks: ['JUnit 5', 'kotest', 'MockK'],
    commonPatterns: [
      {
        name: 'Sealed Classes for Result States',
        description: 'Model exhaustive states with sealed hierarchies and when expressions',
        codeExample: `sealed interface UiState {
    data object Loading : UiState
    data class Success(val items: List<String>) : UiState
    data class Error(val message: String) : UiState
}

fun render(state: UiState): String = when (state) {
    UiState.Loading -> "Yukleniyor"
    is UiState.Success -> state.items.joinToString()
    is UiState.Error -> state.message
}`,
        useCase: 'UI state, API results, command handling',
        antiPattern: 'Boolean flags plus nullable fields that allow invalid combinations'
      },
      {
        name: 'Structured Concurrency with Coroutines',
        description: 'Run suspending work inside a scope so cancellation and errors propagate',
        codeExample: `suspend fun loadDashboard(): Dashboard = coroutineScope {
    val user = async { api.user() }
    val tasks = async { api.tasks() }
    Dashboard(user.await(), tasks.await())
}`,
        useCase: 'Parallel network/database work with cancellation safety'
      }
    ],
    pitfalls: [
      {
        name: 'Platform Types from Java',
        description: 'Java APIs surface as platform types and can throw NPE without compiler warnings',
        codeExample: `// Java method returns String! (platform type)
val name: String = javaApi.getName() // may be null at runtime

// Safer
val name: String? = javaApi.getName()`,
        fix: 'Annotate Java APIs with nullability or assign to nullable types and check',
        severity: 'major'
      }
    ],
    styleGuides: ['https://kotlinlang.org/docs/coding-conventions.html'],
    documentation: ['https://kotlinlang.org/docs/home.html', 'https://developer.android.com/kotlin'],
    standardLibrary: ['Collections', 'Sequences', 'Coroutines', 'Flow', 'Result'],
    ecosystem: ['Ktor', 'Jetpack Compose', 'Exposed', 'Arrow', 'Room']
  },
  scala: {
    name: 'Scala',
    extensions: ['.scala', '.sc'],
    category: 'functional',
    paradigms: ['functional', 'object-oriented', 'generic'],
    packageManager: 'sbt/coursier',
    buildTools: ['sbt', 'mill', 'scala-cli'],
    linters: ['scalafix', 'wartremover'],
    formatters: ['scalafmt'],
    testFrameworks: ['ScalaTest', 'MUnit', 'ZIO Test'],
    commonPatterns: [
      {
        name: 'Case Classes and Pattern Matching',
        description: 'Model immutable data with case classes and destructure with match',
        codeExample: `sealed trait Event
case class Created(id: String) extends Event
case class Deleted(id: String) extends Event

def describe(event: Event): String = event match {
  case Created(id) => s"created $id"
  case Deleted(id) => s"deleted $id"
}`,
        useCase: 'Domain modeling, message handling, ASTs',
        antiPattern: 'Stringly-typed events with if/else on magic values'
      },
      {
        name: 'Option and Either for Errors',
        description: 'Represent absence and failure in the type instead of exceptions',
        codeExample: `def parseAge(raw: String): Either[String, Int] =
  raw.toIntOption.toRight(s"gecersiz yas: $raw")

val result = parseAge("42").map(_ + 1)`,
        useCase: 'Validation pipelines and API boundaries'
      }
    ],
    pitfalls: [
      {
        name: 'Blocking Inside Futures',
        description: 'Awaiting or doing blocking IO inside Future.map starves the execution context',
        codeExample: `// BAD
Future { Thread.sleep(1000) } // blocks pool thread

// GOOD: dedicated blocking pool for blocking calls
val ec = ExecutionContext.fromExecutor(blockingPool)`,
        fix: 'Use a dedicated blocking pool, or prefer non-blocking IO and async APIs',
        severity: 'major'
      }
    ],
    styleGuides: ['https://docs.scala-lang.org/style/'],
    documentation: ['https://docs.scala-lang.org/', 'https://www.scala-lang.org/api/current/'],
    standardLibrary: ['Collections', 'Option/Either/Try', 'Future', 'Given/Using'],
    ecosystem: ['Akka/Pekko', 'http4s', 'ZIO', 'Cats', 'Apache Spark']
  },
  r: {
    name: 'R',
    extensions: ['.r', '.rmd'],
    category: 'data',
    paradigms: ['functional', 'vectorized', 'statistical'],
    packageManager: 'CRAN/renv',
    buildTools: ['R CMD build', 'devtools'],
    linters: ['lintr'],
    formatters: ['styler'],
    testFrameworks: ['testthat'],
    commonPatterns: [
      {
        name: 'Vectorized Operations',
        description: 'Operate on whole vectors instead of looping element by element',
        codeExample: `prices <- c(10, 20, 30)
taxed <- prices * 1.2
cheap <- prices[prices < 25]`,
        useCase: 'Data transformation and filtering',
        antiPattern: 'Growing vectors with c() inside a for loop'
      },
      {
        name: 'Tidyverse Pipelines',
        description: 'Compose readable data steps with the pipe operator',
        codeExample: `library(dplyr)

summary <- orders |>
  filter(status == "paid") |>
  group_by(customer_id) |>
  summarise(total = sum(amount), .groups = "drop") |>
  arrange(desc(total))`,
        useCase: 'Exploratory analysis and reporting pipelines'
      }
    ],
    pitfalls: [
      {
        name: 'Growing Objects in Loops',
        description: 'Repeated c() or rbind() copies the whole object each iteration',
        codeExample: `# BAD
out <- c()
for (i in 1:10000) out <- c(out, i * 2)

# GOOD
out <- vapply(1:10000, function(i) i * 2, numeric(1))`,
        fix: 'Preallocate or use vapply/lapply/purrr map functions which know the output size',
        severity: 'major'
      }
    ],
    styleGuides: ['https://style.tidyverse.org/'],
    documentation: ['https://cran.r-project.org/manuals.html', 'https://r4ds.hadley.nz/'],
    standardLibrary: ['base', 'stats', 'utils', 'methods', 'graphics'],
    ecosystem: ['tidyverse', 'data.table', 'shiny', 'ggplot2', 'caret', 'sf']
  },
  matlab: {
    name: 'MATLAB',
    extensions: ['.m'],
    category: 'data',
    paradigms: ['vectorized', 'procedural', 'object-oriented'],
    packageManager: 'Add-On Explorer',
    buildTools: ['matlab -batch'],
    linters: ['checkcode'],
    formatters: ['matlab -batch'],
    testFrameworks: ['matlab.unittest'],
    commonPatterns: [
      {
        name: 'Preallocation and Vectorization',
        description: 'Preallocate arrays and use vectorized expressions for performance',
        codeExample: `n = 100000;
values = zeros(1, n);
for k = 1:n
    values(k) = k^2;
end

vectorized = (1:n).^2;`,
        useCase: 'Numerical computing and signal processing loops',
        antiPattern: 'Growing arrays with A(end+1) = x inside large loops'
      },
      {
        name: 'Input Validation with arguments Block',
        description: 'Declare argument types and defaults so invalid calls fail early',
        codeExample: `function y = scaleSignal(x, factor)
arguments
    x (1,:) double
    factor (1,1) double {mustBePositive} = 1
end
y = x .* factor;
end`,
        useCase: 'Reusable numerical functions and toolboxes'
      }
    ],
    pitfalls: [
      {
        name: 'Floating-Point Equality',
        description: 'Comparing doubles with == can be false due to rounding',
        codeExample: `% BAD
if 0.1 + 0.2 == 0.3
    disp("esit")
end

% GOOD
if abs((0.1 + 0.2) - 0.3) < 1e-12
    disp("esit")
end`,
        fix: 'Use a tolerance (abs(a-b) < eps) or ismembertol with a tolerance',
        severity: 'major'
      }
    ],
    styleGuides: ['https://www.mathworks.com/matlabcentral/fileexchange/46056-matlab-style-guidelines'],
    documentation: ['https://www.mathworks.com/help/matlab/'],
    standardLibrary: ['matrix operations', 'statistics', 'plotting', 'file IO'],
    ecosystem: ['Simulink', 'Signal Processing Toolbox', 'Image Processing Toolbox', 'Optimization Toolbox']
  },
  sql: {
    name: 'SQL',
    extensions: ['.sql'],
    category: 'data',
    paradigms: ['declarative', 'set-based'],
    packageManager: 'n/a',
    buildTools: ['migrations', 'dbt'],
    linters: ['sqlfluff', 'sql-lint'],
    formatters: ['sqlfluff format', 'pg_format'],
    testFrameworks: ['pgTAP', 'dbt tests'],
    commonPatterns: [
      {
        name: 'CTEs for Readable Queries',
        description: 'Break complex queries into named steps with WITH clauses',
        codeExample: `WITH paid_orders AS (
    SELECT customer_id, SUM(amount) AS total
    FROM orders
    WHERE status = 'paid'
    GROUP BY customer_id
)
SELECT c.name, p.total
FROM paid_orders p
JOIN customers c ON c.id = p.customer_id
ORDER BY p.total DESC;`,
        useCase: 'Reports and multi-step transformations',
        antiPattern: 'Deeply nested subqueries that are impossible to debug'
      },
      {
        name: 'Window Functions for Ranking',
        description: 'Compute per-group rankings without self-joins',
        codeExample: `SELECT customer_id, amount,
       ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY amount DESC) AS rn
FROM orders;`,
        useCase: 'Top-N per group, running totals, deduplication'
      }
    ],
    pitfalls: [
      {
        name: 'N+1 Queries',
        description: 'Fetching a list then querying each row individually overloads the database',
        codeExample: `-- BAD: one query per customer in application code
SELECT * FROM orders WHERE customer_id = ?;

-- GOOD: single set-based query
SELECT customer_id, COUNT(*) AS order_count
FROM orders
GROUP BY customer_id;`,
        fix: 'Use joins, GROUP BY, or batched IN queries instead of per-row lookups',
        severity: 'major'
      },
      {
        name: 'Missing Index on Filter Columns',
        description: 'Filtering/joining on unindexed columns forces full table scans',
        codeExample: `-- Inspect the plan first
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 42;

CREATE INDEX idx_orders_customer ON orders (customer_id);`,
        fix: 'Read query plans, index selective filter/join columns, avoid over-indexing writes',
        severity: 'major'
      }
    ],
    styleGuides: ['https://www.sqlstyle.guide/'],
    documentation: ['https://www.postgresql.org/docs/', 'https://dev.mysql.com/doc/', 'https://www.sqlite.org/docs.html'],
    standardLibrary: ['SELECT/JOIN', 'CTEs', 'window functions', 'transactions', 'indexes'],
    ecosystem: ['PostgreSQL', 'MySQL', 'SQLite', 'SQL Server', 'dbt']
  },
  bash: {
    name: 'Bash',
    extensions: ['.sh', '.bash'],
    category: 'scripting',
    paradigms: ['procedural', 'pipeline-oriented'],
    packageManager: 'system package manager',
    buildTools: [],
    linters: ['shellcheck'],
    formatters: ['shfmt'],
    testFrameworks: ['bats-core', 'shellspec'],
    commonPatterns: [
      {
        name: 'Strict Mode Header',
        description: 'Fail fast on errors, undefined variables, and pipeline failures',
        codeExample: `#!/usr/bin/env bash
set -euo pipefail
IFS=$'\\n\\t'

main() {
  local input=$1
  echo "isleniyor: $input"
}

main "$@"`,
        useCase: 'Every non-trivial automation script',
        antiPattern: 'Scripts that continue silently after a failed command'
      },
      {
        name: 'Quoted Expansions',
        description: 'Quote variables and arrays so word splitting and globbing cannot corrupt arguments',
        codeExample: `for file in "$@"; do
  printf '%s\\n' "$file"
done

count=\${#files[@]}
for item in "\${files[@]}"; do
  process "$item"
done`,
        useCase: 'Handling paths with spaces and user-provided arguments'
      }
    ],
    pitfalls: [
      {
        name: 'Unquoted Variables',
        description: 'Unquoted expansions split on spaces and expand globs unexpectedly',
        codeExample: `# BAD
rm $target          # multiple words become multiple targets
cp $src $dst

# GOOD
rm -- "$target"
cp -- "$src" "$dst"`,
        fix: 'Quote every expansion, use -- before paths, enable shellcheck in CI',
        severity: 'critical'
      }
    ],
    styleGuides: ['https://google.github.io/styleguide/shellguide.html'],
    documentation: ['https://www.gnu.org/software/bash/manual/', 'https://mywiki.wooledge.org/BashGuide'],
    standardLibrary: ['coreutils', 'find', 'sed', 'awk', 'grep', 'curl', 'jq'],
    ecosystem: ['shellcheck', 'shfmt', 'bats-core', 'GNU coreutils', 'jq']
  },
  powershell: {
    name: 'PowerShell',
    extensions: ['.ps1', '.psm1', '.psd1'],
    category: 'scripting',
    paradigms: ['object-oriented', 'pipeline-oriented'],
    packageManager: 'PSGallery',
    buildTools: ['psake', 'Invoke-Build'],
    linters: ['PSScriptAnalyzer'],
    formatters: ['Invoke-Formatter'],
    testFrameworks: ['Pester'],
    commonPatterns: [
      {
        name: 'Advanced Functions with CmdletBinding',
        description: 'Declare parameters with validation and pipeline support instead of positional globals',
        codeExample: `function Get-ActiveUser {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateNotNullOrEmpty()]
        [string]$Path
    )
    Get-Content -LiteralPath $Path | Where-Object { $_.Active -eq $true }
}`,
        useCase: 'Reusable automation modules and tooling',
        antiPattern: 'Functions that depend on script-scope variables or Read-Host prompts'
      },
      {
        name: 'Object Pipelines',
        description: 'Pipe structured objects and use Where-Object/Select-Object/ForEach-Object',
        codeExample: `Get-ChildItem -LiteralPath . -File |
    Where-Object { $_.Length -gt 1MB } |
    Sort-Object Length -Descending |
    Select-Object Name, Length`,
        useCase: 'File, process and service automation'
      }
    ],
    pitfalls: [
      {
        name: 'Automatic Variable Overwrite',
        description: 'Reusing names like $Error, $args, $input, $Host breaks built-in behavior',
        codeExample: `# BAD
$Error = "bir hata"   # overwrites the automatic error collection
$args = @()

# GOOD
$errorMessage = "bir hata"
$arguments = @()`,
        fix: 'Never assign to automatic variables; use descriptive prefixed names',
        severity: 'major'
      }
    ],
    styleGuides: ['https://learn.microsoft.com/powershell/scripting/developer/cmdlet/approved-verbs-for-windows-powershell-commands'],
    documentation: ['https://learn.microsoft.com/powershell/', 'https://pester.dev/docs/quick-start'],
    standardLibrary: ['Get-ChildItem', 'Where-Object', 'ForEach-Object', 'Select-Object', 'ConvertTo-Json', 'Invoke-RestMethod'],
    ecosystem: ['Pester', 'PSScriptAnalyzer', 'PSReadLine', 'platyPS', 'SecretManagement']
  }
};

export function getLanguageInfo(language: string): LanguageInfo | undefined {
  return LANGUAGE_KNOWLEDGE_BASE[language.toLowerCase()];
}

export function getLanguagesByCategory(category: LanguageInfo['category']): LanguageInfo[] {
  return Object.values(LANGUAGE_KNOWLEDGE_BASE).filter(l => l.category === category);
}

export function getLanguageExtensions(language: string): string[] {
  return LANGUAGE_KNOWLEDGE_BASE[language.toLowerCase()]?.extensions ?? [];
}

export function detectLanguage(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  
  for (const [lang, info] of Object.entries(LANGUAGE_KNOWLEDGE_BASE)) {
    if (info.extensions.includes('.' + ext) || info.extensions.includes(ext)) {
      return lang;
    }
  }
  return undefined;
}

// Initialize language knowledge in solution memory
export async function initializeLanguageKnowledge(store: { read: (path: string) => Promise<{ data: { records?: SolutionRecord[] } }> }): Promise<void> {
  const file = await store.read('solution-memory.json')
  const records = file.data.records ?? []
  for (const [lang, info] of Object.entries(LANGUAGE_KNOWLEDGE_BASE)) {
    // Store common patterns
    for (const pattern of info.commonPatterns) {
      const record = sanitizeSolutionRecord({
        problem: `${info.name}: ${pattern.name}`,
        errorMessage: pattern.antiPattern ?? '',
        cause: pattern.description,
        solution: pattern.codeExample,
        outcome: 'solved' as const,
        verifiedBy: `Language pattern: ${pattern.useCase}`,
        sources: info.documentation,
        environmentNote: `Category: ${info.category}, Paradigms: ${info.paradigms.join(', ')}`
      });
      if (record) {
        try {
          await searchSolutionRecords(records, record.problem)
        } catch {
          // Store if not exists
        }
      }
    }
    
    // Store pitfalls
    for (const pitfall of info.pitfalls) {
      const record = sanitizeSolutionRecord({
        problem: `${info.name} Pitfall: ${pitfall.name}`,
        errorMessage: pitfall.codeExample,
        cause: pitfall.description,
        solution: pitfall.fix,
        outcome: 'solved' as const,
        verifiedBy: `Severity: ${pitfall.severity}`,
        sources: info.documentation,
        environmentNote: `Language: ${info.name}`
      });
      if (record) {
        try {
          await searchSolutionRecords(records, record.problem)
        } catch {
          // Store if not exists
        }
      }
    }
  }
}

// Research language-specific best practices from the web
// Note: Actual web search is performed in the tool handler in main.ts
// This function just prepares the research queries
export async function researchLanguageTopic(language: string, topic: string): Promise<string> {
  const info = getLanguageInfo(language);
  if (!info) return `Unknown language: ${language}`;
  
  const queries = [
    `${info.name} ${topic} best practices`,
    `${info.name} ${topic} common mistakes`,
    `${info.name} ${topic} example code`
  ];
  
  // Return the queries that should be researched
  // Actual web search is done in the tool handler in main.ts
  return `Research queries for ${info.name} (${topic}):\n${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
}