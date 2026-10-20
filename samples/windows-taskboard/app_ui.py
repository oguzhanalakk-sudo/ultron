from __future__ import annotations

import os
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, ttk

from task_store import TaskStore


def default_database_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home()))
    return base / "KodAtolyesi" / "WindowsTaskboard" / "tasks.sqlite3"


class TaskBoardApp(tk.Tk):
    def __init__(self, store: TaskStore | None = None) -> None:
        super().__init__()
        self.store = store or TaskStore(default_database_path())
        self.title("Kod Atölyesi Görev Panosu")
        self.geometry("720x500")
        self.minsize(520, 360)
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        heading = ttk.Label(self, text="Görev panosu", font=("Segoe UI", 19, "bold"))
        heading.grid(row=0, column=0, sticky="w", padx=20, pady=(18, 4))
        ttk.Label(self, text="Görevler bu bilgisayardaki SQLite veritabanında saklanır.").grid(
            row=1, column=0, sticky="w", padx=20, pady=(0, 14)
        )

        list_frame = ttk.Frame(self, padding=(20, 0, 20, 0))
        list_frame.grid(row=2, column=0, sticky="nsew")
        list_frame.columnconfigure(0, weight=1)
        list_frame.rowconfigure(1, weight=1)

        search_row = ttk.Frame(list_frame)
        search_row.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        search_row.columnconfigure(1, weight=1)
        ttk.Label(search_row, text="Ara").grid(row=0, column=0, padx=(0, 8))
        self.search_text = tk.StringVar()
        search = ttk.Entry(search_row, textvariable=self.search_text)
        search.grid(row=0, column=1, sticky="ew")
        search.bind("<KeyRelease>", lambda _event: self.refresh())

        self.tasks = ttk.Treeview(list_frame, columns=("title", "state"), show="headings", selectmode="browse")
        self.tasks.heading("title", text="Görev")
        self.tasks.heading("state", text="Durum")
        self.tasks.column("title", width=500, anchor="w", stretch=True)
        self.tasks.column("state", width=95, anchor="center", stretch=False)
        self.tasks.grid(row=1, column=0, sticky="nsew")
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=self.tasks.yview)
        scrollbar.grid(row=1, column=1, sticky="ns")
        self.tasks.configure(yscrollcommand=scrollbar.set)

        add_row = ttk.Frame(self, padding=(20, 14, 20, 8))
        add_row.grid(row=3, column=0, sticky="ew")
        add_row.columnconfigure(0, weight=1)
        self.new_title = tk.StringVar()
        entry = ttk.Entry(add_row, textvariable=self.new_title)
        entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        entry.bind("<Return>", lambda _event: self.add_task())
        ttk.Button(add_row, text="Görev ekle", command=self.add_task).grid(row=0, column=1)

        footer = ttk.Frame(self, padding=(20, 0, 20, 16))
        footer.grid(row=4, column=0, sticky="ew")
        ttk.Button(footer, text="Tamamlandı / geri al", command=self.toggle_selected).pack(side="left")
        self.status = ttk.Label(footer, text="")
        self.status.pack(side="right")
        self.refresh()

    def refresh(self) -> None:
        for item in self.tasks.get_children():
            self.tasks.delete(item)
        tasks = self.store.list_tasks(self.search_text.get())
        for task in tasks:
            state = "Tamamlandı" if task.completed else "Bekliyor"
            self.tasks.insert("", "end", iid=str(task.id), values=(task.title, state))
        self.status.configure(text=f"{sum(not task.completed for task in tasks)} açık görev")

    def add_task(self) -> None:
        try:
            self.store.add_task(self.new_title.get())
            self.new_title.set("")
            self.refresh()
        except ValueError as error:
            messagebox.showwarning("Görev eklenemedi", str(error), parent=self)
        except OSError as error:
            messagebox.showerror("Veritabanı hatası", str(error), parent=self)

    def toggle_selected(self) -> None:
        selected = self.tasks.selection()
        if not selected:
            messagebox.showinfo("Görev seçin", "Durumunu değiştirmek için önce bir görev seçin.", parent=self)
            return
        task_id = int(selected[0])
        existing = next((item for item in self.store.list_tasks() if item.id == task_id), None)
        if existing is None:
            self.refresh()
            return
        self.store.set_completed(task_id, not existing.completed)
        self.refresh()


if __name__ == "__main__":
    TaskBoardApp().mainloop()
