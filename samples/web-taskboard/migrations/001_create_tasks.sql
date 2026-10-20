CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
    description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 1000),
    done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_done_created ON tasks(done, created_at DESC);
