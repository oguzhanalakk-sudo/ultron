from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Iterator


@dataclass(frozen=True)
class Task:
    id: int
    title: str
    completed: bool
    created_at: str


class TaskStore:
    def __init__(self, database_path: str | Path) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._session() as connection:
            connection.execute(
                """CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
                    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )"""
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _session(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def list_tasks(self, search: str = "") -> list[Task]:
        query = search.strip()
        escaped_query = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        with self._session() as connection:
            rows = connection.execute(
                """SELECT id, title, completed, created_at FROM tasks
                   WHERE ? = '' OR title LIKE ? ESCAPE '\\'
                   ORDER BY completed ASC, id DESC""",
                (query, f"%{escaped_query}%"),
            ).fetchall()
        return [Task(row["id"], row["title"], bool(row["completed"]), row["created_at"]) for row in rows]

    def add_task(self, title: str) -> Task:
        clean_title = title.strip()
        if not clean_title:
            raise ValueError("Görev adı boş bırakılamaz.")
        if len(clean_title) > 200:
            raise ValueError("Görev adı en fazla 200 karakter olabilir.")
        with self._session() as connection:
            cursor = connection.execute("INSERT INTO tasks (title) VALUES (?)", (clean_title,))
            row = connection.execute(
                "SELECT id, title, completed, created_at FROM tasks WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
        return Task(row["id"], row["title"], bool(row["completed"]), row["created_at"])

    def set_completed(self, task_id: int, completed: bool) -> bool:
        with self._session() as connection:
            cursor = connection.execute(
                "UPDATE tasks SET completed = ? WHERE id = ?",
                (int(completed), task_id),
            )
            return cursor.rowcount == 1
