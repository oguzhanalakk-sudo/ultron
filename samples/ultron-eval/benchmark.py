#!/usr/bin/env python3
"""
Ultron Continuous Benchmark Runner

Belirli aralıklarla benchmark koşar, trendleri takip eder, regresyon tespit eder.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from run_evaluation import UltronEvalRunner, StuckDetectionConfig


DB_PATH = Path(__file__).parent / "benchmark_history.db"


def init_db():
    """Geçmiş veritabanını başlat"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                model TEXT NOT NULL,
                total_tasks INTEGER,
                passed INTEGER,
                failed INTEGER,
                stuck_count INTEGER,
                avg_duration REAL,
                config_json TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS task_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER,
                task_id TEXT,
                task_name TEXT,
                category TEXT,
                success INTEGER,
                duration_sec REAL,
                error_type TEXT,
                stuck_detected INTEGER,
                metrics_json TEXT,
                FOREIGN KEY (run_id) REFERENCES runs(id)
            )
        """)
        conn.commit()


def save_run(runner: UltronEvalRunner, model: str, config: StuckDetectionConfig) -> int:
    """Koşum sonucunu kaydet"""
    total = len(runner.results)
    passed = sum(1 for r in runner.results if r.success)
    failed = total - passed
    stuck = sum(1 for r in runner.results if r.stuck_detected)
    avg_dur = sum(r.duration_sec for r in runner.results) / total if total > 0 else 0
    
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute("""
            INSERT INTO runs (timestamp, model, total_tasks, passed, failed, stuck_count, avg_duration, config_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            datetime.now().isoformat(),
            model,
            total,
            passed,
            failed,
            stuck,
            avg_dur,
            json.dumps(asdict(config))
        ))
        run_id = cursor.lastrowid
        
        for r in runner.results:
            conn.execute("""
                INSERT INTO task_results (run_id, task_id, task_name, category, success, duration_sec, error_type, stuck_detected, metrics_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                run_id, r.task_id, r.task_name, r.category,
                1 if r.success else 0,
                r.duration_sec,
                r.error_type,
                1 if r.stuck_detected else 0,
                json.dumps(r.metrics)
            ))
        conn.commit()
        return run_id


def show_history(limit: int = 10):
    """Geçmiş koşumları göster"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT * FROM runs ORDER BY timestamp DESC LIMIT ?
        """, (limit,)).fetchall()
        
        print(f"\n{'='*80}")
        print(f"BENCHMARK HISTORY (last {limit} runs)")
        print(f"{'='*80}")
        for row in rows:
            print(f"\nRun #{row['id']} - {row['timestamp']}")
            print(f"  Model: {row['model']} | Tasks: {row['total_tasks']} | Passed: {row['passed']} | Failed: {row['failed']} | Stuck: {row['stuck_count']} | Avg: {row['avg_duration']:.2f}s")


def show_trends(task_id: str = None, days: int = 30):
    """Trend analizi"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        
        if task_id:
            rows = conn.execute("""
                SELECT r.timestamp, tr.success, tr.duration_sec, tr.error_type, tr.stuck_detected
                FROM task_results tr
                JOIN runs r ON tr.run_id = r.id
                WHERE tr.task_id = ? AND r.timestamp > datetime('now', ?)
                ORDER BY r.timestamp
            """, (task_id, f'-{days} days')).fetchall()
            
            print(f"\nTrend for {task_id} (last {days} days):")
            for row in rows:
                status = "✅" if row['success'] else "❌"
                stuck = " 🔴" if row['stuck_detected'] else ""
                print(f"  {row['timestamp'][:19]} {status}{stuck} {row['duration_sec']:.2f}s {row['error_type'] or ''}")
        else:
            # Genel trend
            rows = conn.execute("""
                SELECT date(timestamp) as day, 
                       AVG(passed*1.0/total_tasks)*100 as pass_rate,
                       AVG(avg_duration) as avg_dur
                FROM runs
                WHERE timestamp > datetime('now', ?)
                GROUP BY date(timestamp)
                ORDER BY day
            """, (f'-{days} days',)).fetchall()
            
            print(f"\nOverall Pass Rate Trend (last {days} days):")
            for row in rows:
                print(f"  {row['day']}: {row['pass_rate']:.1f}% pass, avg {row['avg_dur']:.2f}s")


def detect_regression(current_results: list, threshold: float = 0.1):
    """Regresyon tespiti - önceki koşumla karşılaştır"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        prev_run = conn.execute("""
            SELECT id FROM runs ORDER BY timestamp DESC LIMIT 1 OFFSET 1
        """).fetchone()
        
        if not prev_run:
            print("No previous run to compare")
            return
        
        prev_results = conn.execute("""
            SELECT task_id, success FROM task_results WHERE run_id = ?
        """, (prev_run['id'],)).fetchall()
        
        prev_map = {r['task_id']: r['success'] for r in prev_results}
        curr_map = {r.task_id: 1 if r.success else 0 for r in current_results}
        
        regressed = []
        improved = []
        
        for task_id, curr_success in curr_map.items():
            if task_id in prev_map:
                prev_success = prev_map[task_id]
                if prev_success == 1 and curr_success == 0:
                    regressed.append(task_id)
                elif prev_success == 0 and curr_success == 1:
                    improved.append(task_id)
        
        if regressed:
            print(f"\n⚠️ REGRESSION DETECTED ({len(regressed)} tasks):")
            for t in regressed:
                print(f"  - {t}")
        else:
            print("\n✅ No regressions detected")
        
        if improved:
            print(f"\n✨ IMPROVEMENTS ({len(improved)} tasks):")
            for t in improved:
                print(f"  - {t}")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Ultron Continuous Benchmark')
    parser.add_argument('--run', action='store_true', help='Run benchmark and save')
    parser.add_argument('--history', action='store_true', help='Show history')
    parser.add_argument('--trend', nargs='?', const='all', help='Show trends (task_id or all)')
    parser.add_argument('--detect-regression', action='store_true', help='Compare with previous run')
    parser.add_argument('--model', default='qwen3:8b')
    parser.add_argument('--tasks', nargs='+')
    parser.add_argument('--categories', nargs='+')
    parser.add_argument('--timeout', type=int, default=120)
    
    args = parser.parse_args()
    
    init_db()
    
    if args.history:
        show_history()
        return
    
    if args.trend:
        show_trends(args.trend if args.trend != 'all' else None)
        return
    
    if args.run:
        config = StuckDetectionConfig(max_duration_sec=args.timeout)
        runner = UltronEvalRunner(config)
        runner.ollama.model = args.model
        
        import asyncio
        results = asyncio.run(runner.run_evaluation(
            task_ids=args.tasks,
            categories=args.categories
        ))
        
        run_id = save_run(runner, args.model, config)
        print(f"Run saved with ID: {run_id}")
        
        if args.detect_regression:
            detect_regression(results)
        
        runner.generate_report(f"benchmark_report_{run_id}.md")
    
    if args.detect_regression and not args.run:
        # Son koşumu yükle ve karşılaştır
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            last_run = conn.execute("SELECT id FROM runs ORDER BY timestamp DESC LIMIT 1").fetchone()
            if last_run:
                # Mock current results for demo
                detect_regression([])


if __name__ == '__main__':
    main()