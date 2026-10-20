import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from task_store import TaskStore


class TaskStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary.name) / "tasks.sqlite3"
        self.store = TaskStore(self.database)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_tasks_persist_between_store_instances(self) -> None:
        saved = self.store.add_task("Metraj raporunu hazırla")
        reopened = TaskStore(self.database)
        self.assertEqual(reopened.list_tasks(), [saved])

    def test_completion_and_search_are_applied(self) -> None:
        task = self.store.add_task("Mutfak ölçülerini kontrol et")
        self.assertTrue(self.store.set_completed(task.id, True))
        self.assertTrue(self.store.list_tasks("mutfak")[0].completed)
        self.assertEqual(self.store.list_tasks("olmayan"), [])
        self.assertFalse(self.store.set_completed(999, True))

    def test_blank_or_too_long_titles_are_rejected(self) -> None:
        with self.assertRaises(ValueError):
            self.store.add_task("   ")
        with self.assertRaises(ValueError):
            self.store.add_task("x" * 201)


if __name__ == "__main__":
    unittest.main()
