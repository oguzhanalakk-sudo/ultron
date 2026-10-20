#!/usr/bin/env python3
"""
Ultron Code Generation Evaluation Runner

Bu modül Ultron'un (veya doğrudan Ollama modelinin) kod yazma yeteneğini test eder:
- Benchmark görevlerini çalıştırır
- Üretilen kodu çalıştırır ve doğrular
- Takılma/döngü tespiti yapar
- Detaylı rapor üretir
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import traceback
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Optional
from benchmarks import BENCHMARK_TASKS


@dataclass
class EvaluationResult:
    task_id: str
    task_name: str
    category: str
    success: bool
    duration_sec: float
    model_turns: int = 0
    tool_calls: int = 0
    correction_attempts: int = 0
    stuck_detected: bool = False
    stuck_reason: str = ""
    error_type: str = ""  # syntax, runtime, logic, timeout, stuck
    error_message: str = ""
    output: str = ""
    expected_output: str = ""
    generated_code: str = ""
    metrics: dict = field(default_factory=dict)


@dataclass
class StuckDetectionConfig:
    max_duration_sec: int = 120
    max_model_turns: int = 30
    max_tool_calls: int = 50
    max_correction_attempts: int = 5
    max_no_progress_sec: int = 30
    repeated_failure_threshold: int = 3


class CodeExecutor:
    """Güvenli kod çalıştırma ortamı"""
    
    def __init__(self, timeout_sec: int = 60):
        self.timeout_sec = timeout_sec
    
    def execute(self, code: str, language: str = "python", stdin_input: str = "", timeout_sec: int = None) -> dict:
        """Kodu çalıştır ve sonuç döndür"""
        if language != "python":
            return {"success": False, "error": f"Unsupported language: {language}", "output": ""}
        
        effective_timeout = timeout_sec if timeout_sec is not None else self.timeout_sec
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as f:
            f.write(code)
            temp_path = f.name
        
        try:
            start = time.time()
            result = subprocess.run(
                [sys.executable, temp_path],
                capture_output=True,
                text=True,
                timeout=effective_timeout + 5,
                input=stdin_input
            )
            duration = time.time() - start
            
            return {
                "success": result.returncode == 0,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "duration": duration,
                "output": result.stdout + ("\n[STDERR]\n" + result.stderr if result.stderr else "")
            }
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Execution timeout", "output": "", "timeout": True}
        except Exception as e:
            return {"success": False, "error": str(e), "output": ""}
        finally:
            try:
                os.unlink(temp_path)
            except:
                pass
    
    def _wrap_with_timeout(self, code: str, timeout: int) -> str:
        """Kodu timeout wrapper ile sar"""
        return f'''
import sys
import signal
import threading

class TimeoutException(Exception):
    pass

def timeout_handler(signum, frame):
    raise TimeoutException("Execution timeout")

# Unix-like timeout
if hasattr(signal, 'SIGALRM'):
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm({timeout})

# Cross-platform timeout using thread
result = {{"done": False, "error": None}}
def run_code():
    try:
{textwrap.indent(code, '        ')}
        result["done"] = True
    except Exception as e:
        result["error"] = e

thread = threading.Thread(target=run_code)
thread.daemon = True
thread.start()
thread.join({timeout})

if not result["done"]:
    print("EXECUTION_TIMEOUT", file=sys.stderr)
    sys.exit(1)
if result["error"]:
    raise result["error"]
if hasattr(signal, 'SIGALRM'):
    signal.alarm(0)
'''


class OllamaClient:
    """Ollama API istemcisi - doğrudan model testi için"""
    
    def __init__(self, base_url: str = "http://127.0.0.1:11434", model: str = "qwen3:8b"):
        self.base_url = base_url.rstrip('/')
        self.model = model
    
    async def generate(self, prompt: str, system_prompt: str = "", temperature: float = 0.1) -> str:
        """Ollama'dan kod üret"""
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                payload = {
                    "model": self.model,
                    "prompt": prompt,
                    "system": system_prompt,
                    "temperature": temperature,
                    "stream": False,
                    "options": {
                        "num_ctx": 8192,
                        "num_predict": 4096
                    }
                }
                async with session.post(f"{self.base_url}/api/generate", json=payload) as resp:
                    if resp.status != 200:
                        text = await resp.text()
                        raise Exception(f"Ollama error {resp.status}: {text}")
                    data = await resp.json()
                    return data.get("response", "")
        except ImportError:
            # aiohttp yoksa sync fallback
            import urllib.request
            payload = {
                "model": self.model,
                "prompt": prompt,
                "system": system_prompt,
                "temperature": temperature,
                "stream": False
            }
            req = urllib.request.Request(
                f"{self.base_url}/api/generate",
                data=json.dumps(payload).encode(),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode())
                return data.get("response", "")
    
    def generate_sync(self, prompt: str, system_prompt: str = "", temperature: float = 0.1) -> str:
        """Senkron versiyon"""
        import urllib.request
        payload = {
            "model": self.model,
            "prompt": prompt,
            "system": system_prompt,
            "temperature": temperature,
            "stream": False
        }
        req = urllib.request.Request(
            f"{self.base_url}/api/generate",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
            return data.get("response", "")


class UltronEvalRunner:
    """Ana değerlendirme koşturucusu"""
    
    def __init__(self, config: StuckDetectionConfig = None):
        self.config = config or StuckDetectionConfig()
        self.executor = CodeExecutor()
        self.ollama = OllamaClient()
        self.results: list[EvaluationResult] = []
        self.current_task: Optional[dict] = None
        self.generation_start_time: float = 0
        self.model_turns: int = 0
        self.tool_calls: int = 0
        self.correction_attempts: int = 0
        self.last_progress_time: float = 0
        self.progress_markers: list = []
    
    def build_prompt(self, task: dict) -> tuple[str, str]:
        """Görev için system ve user prompt'u oluştur"""
        system_prompt = f"""Sen deneyimli bir Python geliştiricisisin. Görevi anla, temiz, çalışır, test edilebilir kod yaz.
Kurallar:
1. Sadece kod yaz, açıklama yapma (kodun kendisi anlaşılır olmalı)
2. Hata yönetimi ekle (try/except, validation)
3. Edge case'leri işle
4. Kodun çalıştırılabilir olmalı (main guard kullan)
5. Print ile sonuçları göster
6. External dependency kullanma (sadece stdlib)

Görev: {task['description']}
Kategori: {task['category']}
Zorluk: {task['difficulty']}
Zaman limiti: {task['timeout_sec']} saniye
"""
        
        user_prompt = f"""Aşağıdaki görevi çöz:

{task['description']}

Beklenen davranış: {task.get('reference_solution', 'Yok')[:200]}...

Kodu ```python ... ``` bloğu içinde ver."""
        
        return system_prompt, user_prompt
    
    def extract_code(self, response: str) -> str:
        """Model yanıtından kod bloğunu çıkar"""
        # ```python ... ``` bloğunu bul
        pattern = r'```(?:python)?\n(.*?)\n```'
        matches = re.findall(pattern, response, re.DOTALL)
        if matches:
            return matches[0].strip()
        
        # Fallback: indentasyonlu kod bloğu ara
        lines = response.split('\n')
        code_lines = []
        in_code = False
        for line in lines:
            if line.strip().startswith(('def ', 'class ', 'import ', 'from ', 'if __name__', 'print(', 'async def', 'await ')):
                in_code = True
            if in_code:
                code_lines.append(line)
        if code_lines:
            return '\n'.join(code_lines).strip()
        
        return response.strip()
    
    def validate_output(self, task: dict, actual_output: str) -> tuple[bool, str]:
        """Çıktıyı bekinenle karşılaştır"""
        expected = task.get('expected_output_contains', [])
        if expected:
            for exp in expected:
                if str(exp) not in actual_output:
                    return False, f"Expected '{exp}' not found in output"
        
        if task.get('expected_line_count'):
            lines = actual_output.strip().split('\n')
            if len(lines) != task['expected_line_count']:
                return False, f"Line count mismatch: expected {task['expected_line_count']}, got {len(lines)}"
        
        if task.get('expected_same_as_input'):
            # JSON roundtrip testi için
            pass
        
        return True, ""
    
    def detect_stuck(self, result: dict, duration: float) -> tuple[bool, str]:
        """Takılma tespiti"""
        # Timeout
        if duration > self.config.max_duration_sec:
            return True, f"Max duration exceeded: {duration:.1f}s > {self.config.max_duration_sec}s"
        
        # Model tur sayısı (approx - response length based)
        # Gerçek takip için agent loop entegrasyonu gerekir
        
        # Output'ta döngü işaretleri
        output = result.get('output', '')
        if output.count('Traceback') > 5:
            return True, "Repeated tracebacks detected"
        
        # "stuck", "loop", "infinite" kelimeleri
        if any(w in output.lower() for w in ['infinite loop', 'stuck', 'hanging', 'deadlock']):
            return True, "Stuck indicators in output"
        
        return False, ""
    
    def classify_error(self, result: dict) -> str:
        """Hata türünü sınıflandır"""
        if result.get('timeout'):
            return 'timeout'
        stderr = result.get('stderr', '') + result.get('stdout', '')
        if 'SyntaxError' in stderr or 'IndentationError' in stderr:
            return 'syntax'
        if any(e in stderr for e in ['NameError', 'AttributeError', 'TypeError', 'KeyError', 'IndexError', 'ValueError']):
            return 'runtime'
        if 'TimeoutException' in stderr or 'EXECUTION_TIMEOUT' in stderr:
            return 'timeout'
        returncode = result.get('returncode')
        if returncode is not None and returncode != 0:
            return 'runtime'
        return 'logic'
    
    async def evaluate_task(self, task: dict) -> EvaluationResult:
        """Tek bir görevi değerlendir"""
        print(f"\n{'='*60}")
        print(f"Evaluating: {task['id']} - {task['name']}")
        print(f"Category: {task['category']} | Difficulty: {task['difficulty']}")
        print(f"{'='*60}")
        
        start_time = time.time()
        
        # Prompt oluştur
        system_prompt, user_prompt = self.build_prompt(task)
        
        # Modelden kod iste
        print("Requesting code from model...")
        self.generation_start_time = time.time()
        
        try:
            response = self.ollama.generate_sync(user_prompt, system_prompt)
            generation_time = time.time() - self.generation_start_time
        except Exception as e:
            return EvaluationResult(
                task_id=task['id'],
                task_name=task['name'],
                category=task['category'],
                success=False,
                duration_sec=time.time() - start_time,
                error_type='model_error',
                error_message=f"Model generation failed: {e}",
                metrics={'generation_time': 0}
            )
        
        # Kodu çıkar
        generated_code = self.extract_code(response)
        if not generated_code:
            return EvaluationResult(
                task_id=task['id'],
                task_name=task['name'],
                category=task['category'],
                success=False,
                duration_sec=time.time() - start_time,
                error_type='no_code',
                error_message="No code extracted from model response",
                generated_code=response[:500],
                metrics={'generation_time': generation_time}
            )
        
        print(f"Generated code ({len(generated_code)} chars):")
        print(generated_code[:300] + ("..." if len(generated_code) > 300 else ""))
        
        # Kodu çalıştır
        print("Executing generated code...")
        exec_result = self.executor.execute(generated_code, task.get('language', 'python'))
        
        total_duration = time.time() - start_time
        
        # Çıktıyı doğrula
        output = exec_result.get('output', '')
        validation_ok, validation_msg = self.validate_output(task, output)
        
        # Takılma tespiti
        stuck, stuck_reason = self.detect_stuck(exec_result, total_duration)
        
        # Hata sınıflandırması
        error_type = self.classify_error(exec_result) if not exec_result.get('success') else ''
        
        success = exec_result.get('success', False) and validation_ok and not stuck
        
        result = EvaluationResult(
            task_id=task['id'],
            task_name=task['name'],
            category=task['category'],
            success=success,
            duration_sec=total_duration,
            model_turns=1,  # Tek seferlik generation
            tool_calls=0,
            correction_attempts=0,
            stuck_detected=stuck,
            stuck_reason=stuck_reason,
            error_type=error_type,
            error_message=validation_msg or exec_result.get('error', ''),
            output=output[:2000],
            expected_output=str(task.get('expected_output_contains', '')),
            generated_code=generated_code,
            metrics={
                'generation_time': generation_time,
                'execution_time': exec_result.get('duration', 0),
                'returncode': exec_result.get('returncode'),
                'code_length': len(generated_code),
                'validation_msg': validation_msg
            }
        )
        
        status = "✅ PASS" if success else "❌ FAIL"
        if stuck:
            status += " 🔴 STUCK"
        print(f"\nResult: {status}")
        if not success:
            print(f"  Error type: {error_type}")
            print(f"  Message: {result.error_message}")
            if stuck:
                print(f"  Stuck reason: {stuck_reason}")
        print(f"  Duration: {total_duration:.2f}s")
        
        return result
    
    async def run_evaluation(self, task_ids: list[str] = None, categories: list[str] = None) -> list[EvaluationResult]:
        """Değerlendirmeyi koştur"""
        tasks_to_run = BENCHMARK_TASKS
        
        if task_ids:
            tasks_to_run = [t for t in tasks_to_run if t['id'] in task_ids]
        if categories:
            tasks_to_run = [t for t in tasks_to_run if t['category'] in categories]
        
        print(f"Starting evaluation of {len(tasks_to_run)} tasks...")
        print(f"Config: max_duration={self.config.max_duration_sec}s, max_turns={self.config.max_model_turns}")
        
        for task in tasks_to_run:
            try:
                result = await self.evaluate_task(task)
                self.results.append(result)
            except Exception as e:
                print(f"Task {task['id']} crashed: {e}")
                traceback.print_exc()
                self.results.append(EvaluationResult(
                    task_id=task['id'],
                    task_name=task['name'],
                    category=task['category'],
                    success=False,
                    duration_sec=0,
                    error_type='runner_error',
                    error_message=str(e)
                ))
        
        return self.results
    
    def generate_report(self, output_path: str = None) -> str:
        """Değerlendirme raporu oluştur"""
        total = len(self.results)
        passed = sum(1 for r in self.results if r.success)
        failed = total - passed
        stuck_count = sum(1 for r in self.results if r.stuck_detected)
        
        by_category = {}
        for r in self.results:
            if r.category not in by_category:
                by_category[r.category] = {'total': 0, 'passed': 0, 'stuck': 0}
            by_category[r.category]['total'] += 1
            if r.success:
                by_category[r.category]['passed'] += 1
            if r.stuck_detected:
                by_category[r.category]['stuck'] += 1
        
        by_error_type = {}
        for r in self.results:
            if not r.success and r.error_type:
                by_error_type[r.error_type] = by_error_type.get(r.error_type, 0) + 1
        
        avg_duration = sum(r.duration_sec for r in self.results) / total if total > 0 else 0
        
        report = f"""
# Ultron Code Generation Evaluation Report
Generated: {time.strftime('%Y-%m-%d %H:%M:%S')}

## Summary
- **Total Tasks**: {total}
- **Passed**: {passed} ({passed/total*100:.1f}%)
- **Failed**: {failed} ({failed/total*100:.1f}%)
- **Stuck Detected**: {stuck_count} ({stuck_count/total*100:.1f}%)
- **Average Duration**: {avg_duration:.2f}s

## By Category
"""
        for cat, stats in sorted(by_category.items()):
            pct = stats['passed'] / stats['total'] * 100 if stats['total'] > 0 else 0
            report += f"- **{cat}**: {stats['passed']}/{stats['total']} ({pct:.1f}%)"
            if stats['stuck'] > 0:
                report += f" ⚠️ {stats['stuck']} stuck"
            report += "\n"
        
        report += f"\n## Error Types\n"
        for err, count in sorted(by_error_type.items(), key=lambda x: -x[1]):
            report += f"- **{err}**: {count}\n"
        
        report += "\n## Detailed Results\n"
        for r in self.results:
            status = "✅" if r.success else "❌"
            if r.stuck_detected:
                status += " 🔴"
            report += f"\n### {status} {r.task_id} - {r.task_name}\n"
            report += f"- Category: {r.category}\n"
            report += f"- Duration: {r.duration_sec:.2f}s\n"
            if r.error_type:
                report += f"- Error Type: {r.error_type}\n"
            if r.error_message:
                report += f"- Error: {r.error_message[:200]}\n"
            if r.stuck_detected:
                report += f"- 🔴 STUCK: {r.stuck_reason}\n"
            report += f"- Code Length: {r.metrics.get('code_length', 0)} chars\n"
        
        if output_path:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(report)
            print(f"Report saved to {output_path}")
        
        return report


async def main():
    """Ana fonksiyon"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Ultron Code Generation Evaluator')
    parser.add_argument('--task', nargs='+', help='Specific task IDs to run')
    parser.add_argument('--category', nargs='+', help='Categories to run')
    parser.add_argument('--output', '-o', help='Report output file')
    parser.add_argument('--model', default='qwen3:8b', help='Ollama model name')
    parser.add_argument('--timeout', type=int, default=120, help='Max duration per task (sec)')
    parser.add_argument('--list', action='store_true', help='List available tasks')
    
    args = parser.parse_args()
    
    if args.list:
        print("Available benchmark tasks:")
        for t in BENCHMARK_TASKS:
            print(f"  {t['id']} ({t['category']}, {t['difficulty']}): {t['name']}")
        return
    
    config = StuckDetectionConfig(max_duration_sec=args.timeout)
    runner = UltronEvalRunner(config)
    runner.ollama.model = args.model
    
    print(f"Using model: {args.model}")
    
    results = await runner.run_evaluation(
        task_ids=args.task,
        categories=args.category
    )
    
    report = runner.generate_report(args.output)
    print("\n" + "="*60)
    print(report)
    
    # Exit code based on results
    failed = sum(1 for r in results if not r.success)
    sys.exit(1 if failed > 0 else 0)


if __name__ == '__main__':
    asyncio.run(main())