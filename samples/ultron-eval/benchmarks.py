# Ultron Code Generation Evaluation Benchmarks
#
# This file defines standardized tasks for testing Ultron's code generation ability.
#
# Task Categories:
# 1. Basic Algorithms - Sorting, searching, basic data structures
# 2. Error Handling - Try/except, validation, edge cases
# 3. File Operations - Read, write, parse, serialization
# 4. Async/Concurrency - Threading, async/await, race conditions
# 5. API/Integration - HTTP requests, JSON parsing, error codes
# 6. Stuck Detection - Infinite loops, repeated failures, progress stall
#
# Metrics collected per task:
# - Success: Output matches expected
# - Duration: Total execution time (seconds)
# - Model Turns: Number of LLM calls
# - Tool Calls: Number of tool invocations
# - Correction Attempts: Retries after errors
# - Stuck Detected: Timeout / loop / no-progress detection
# - Error Type: syntax / runtime / logic / timeout / stuck

BENCHMARK_TASKS = [
    {
        "id": "basic_01_fizzbuzz",
        "category": "basic_algorithms",
        "name": "FizzBuzz Implementation",
        "description": "Print numbers 1 to 100. For multiples of 3 print 'Fizz', multiples of 5 print 'Buzz', both print 'FizzBuzz'.",
        "language": "python",
        "expected_output_contains": ["FizzBuzz", "Fizz", "Buzz"],
        "expected_line_count": 100,
        "timeout_sec": 30,
        "difficulty": "easy",
        "reference_solution": "for i in range(1, 101):\n    if i % 15 == 0: print('FizzBuzz')\n    elif i % 3 == 0: print('Fizz')\n    elif i % 5 == 0: print('Buzz')\n    else: print(i)"
    },
    {
        "id": "basic_02_fibonacci",
        "category": "basic_algorithms",
        "name": "Fibonacci Sequence",
        "description": "Calculate first 20 Fibonacci numbers and return as list. Use iterative approach.",
        "language": "python",
        "expected_output_contains": [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181],
        "timeout_sec": 30,
        "difficulty": "easy",
        "reference_solution": "def fibonacci(n):\n    a, b = 0, 1\n    result = []\n    for _ in range(n):\n        result.append(a)\n        a, b = b, a + b\n    return result\nprint(fibonacci(20))"
    },
    {
        "id": "basic_03_prime_sieve",
        "category": "basic_algorithms",
        "name": "Sieve of Eratosthenes",
        "description": "Find prime numbers up to 100 using Sieve of Eratosthenes algorithm.",
        "language": "python",
        "expected_output_contains": [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97],
        "timeout_sec": 30,
        "difficulty": "medium",
        "reference_solution": "def sieve(n):\n    is_prime = [True] * (n + 1)\n    is_prime[0] = is_prime[1] = False\n    for i in range(2, int(n**0.5) + 1):\n        if is_prime[i]:\n            for j in range(i*i, n+1, i):\n                is_prime[j] = False\n    return [i for i, prime in enumerate(is_prime) if prime]\nprint(sieve(100))"
    },

    {
        "id": "error_01_division_by_zero",
        "category": "error_handling",
        "name": "Safe Division",
        "description": "Write a function that divides two numbers. Catch division by zero and return meaningful error.",
        "language": "python",
        "test_cases": [
            {"input": {"a": 10, "b": 2}, "expected": 5.0},
            {"input": {"a": 10, "b": 0}, "expected_error": "ZeroDivisionError"},
            {"input": {"a": 5, "b": 2}, "expected": 2.5}
        ],
        "timeout_sec": 30,
        "difficulty": "easy",
        "reference_solution": "def safe_divide(a, b):\n    try:\n        return a / b\n    except ZeroDivisionError:\n        return {'error': 'Cannot divide by zero', 'code': 'DIV_BY_ZERO'}\n\nprint(safe_divide(10, 2))\nprint(safe_divide(10, 0))"
    },
    {
        "id": "error_02_file_not_found",
        "category": "error_handling",
        "name": "Robust File Reader",
        "description": "Write a function that reads a file. Handle missing file, permission error, empty file.",
        "language": "python",
        "test_cases": [
            {"setup": "create_temp_file('hello world')", "input": "temp_file.txt", "expected_contains": "hello world"},
            {"setup": "none", "input": "nonexistent.txt", "expected_error": "FileNotFoundError"},
            {"setup": "create_empty_file", "input": "empty.txt", "expected_contains": ""}
        ],
        "timeout_sec": 30,
        "difficulty": "medium",
        "reference_solution": "def read_file_safe(path):\n    try:\n        with open(path, 'r') as f:\n            content = f.read()\n        if not content:\n            return {'warning': 'File is empty', 'content': ''}\n        return {'content': content}\n    except FileNotFoundError:\n        return {'error': 'File not found', 'code': 'NOT_FOUND'}\n    except PermissionError:\n        return {'error': 'Permission denied', 'code': 'PERMISSION_DENIED'}\n    except Exception as e:\n        return {'error': str(e), 'code': 'READ_ERROR'}"
    },

    {
        "id": "file_01_json_roundtrip",
        "category": "file_operations",
        "name": "JSON Config Roundtrip",
        "description": "Write config dict to JSON file, then read back and verify. Support nested dict and list.",
        "language": "python",
        "test_input": {"app": "test", "version": "1.0", "features": ["a", "b"], "config": {"debug": True, "port": 8080}},
        "expected_same_as_input": True,
        "timeout_sec": 30,
        "difficulty": "easy",
        "reference_solution": "import json, tempfile, os\n\ndef write_config(config, path):\n    with open(path, 'w') as f:\n        json.dump(config, f, indent=2)\n\ndef read_config(path):\n    with open(path, 'r') as f:\n        return json.load(f)\n\nwith tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:\n    path = f.name\ntry:\n    config = {'app': 'test', 'version': '1.0', 'features': ['a', 'b'], 'config': {'debug': True, 'port': 8080}}\n    write_config(config, path)\n    loaded = read_config(path)\n    assert loaded == config, 'Mismatch!'\n    print('SUCCESS: Roundtrip OK')\nfinally:\n    os.unlink(path)"
    },
    {
        "id": "file_02_csv_parser",
        "category": "file_operations",
        "name": "CSV Parser with Validation",
        "description": "Read CSV file, convert each row to dict, validate required fields (name, email, age). Skip invalid rows and report.",
        "language": "python",
        "test_input_csv": "name,email,age\nJohn,john@test.com,30\nJane,jane@test.com,25\nBob,invalid-email,40\nAlice,alice@test.com,abc\n",
        "expected_valid_count": 2,
        "expected_invalid_count": 2,
        "timeout_sec": 30,
        "difficulty": "medium",
        "reference_solution": "import csv, io, re\n\ndef parse_csv_with_validation(csv_content):\n    reader = csv.DictReader(io.StringIO(csv_content))\n    valid = []\n    invalid = []\n    email_regex = r'^[^@]+@[^@]+\\.[^@]+$'\n    for i, row in enumerate(reader, 1):\n        errors = []\n        if not row.get('name'): errors.append('Missing name')\n        if not row.get('email') or not re.match(email_regex, row['email']): errors.append('Invalid email')\n        try: age = int(row.get('age', 0)); assert age > 0\n        except: errors.append('Invalid age')\n        if errors:\n            invalid.append({'row': i, 'data': row, 'errors': errors})\n        else:\n            valid.append({**row, 'age': int(row['age'])})\n    return {'valid': valid, 'invalid': invalid, 'summary': f'{len(valid)} valid, {len(invalid)} invalid'}"
    },

    {
        "id": "async_01_concurrent_fetch",
        "category": "async_concurrency",
        "name": "Concurrent HTTP Fetch with Retry",
        "description": "Fetch 3 URLs concurrently, each with 3 retries and exponential backoff. Collect results.",
        "language": "python",
        "note": "Use mock server instead of real HTTP",
        "expected_behavior": "All 3 URLs fetched successfully, retry count reported",
        "timeout_sec": 60,
        "difficulty": "hard",
        "reference_solution": "import asyncio, random\n\nasync def fetch_with_retry(url, max_retries=3):\n    for attempt in range(max_retries):\n        try:\n            await asyncio.sleep(0.1)  # Simulate network\n            if random.random() > 0.3:  # 70% success\n                return {'url': url, 'status': 'ok', 'attempts': attempt + 1}\n        except Exception:\n            pass\n        await asyncio.sleep(0.1 * (2 ** attempt))  # Exponential backoff\n    return {'url': url, 'status': 'failed', 'attempts': max_retries}\n\nasync def main():\n    urls = ['http://api1.example.com', 'http://api2.example.com', 'http://api3.example.com']\n    results = await asyncio.gather(*[fetch_with_retry(u) for u in urls])\n    print({'results': results, 'success': sum(1 for r in results if r['status'] == 'ok')})\n\nasyncio.run(main())"
    },
    {
        "id": "async_02_producer_consumer",
        "category": "async_concurrency",
        "name": "Thread-Safe Queue Producer/Consumer",
        "description": "Producer creates 10 items, 3 consumers process them. Queue size 5. All items processed, no deadlock.",
        "language": "python",
        "expected_processed": 10,
        "timeout_sec": 30,
        "difficulty": "hard",
        "reference_solution": "import threading, queue, time, random\n\nq = queue.Queue(maxsize=5)\nresults = []\nlock = threading.Lock()\n\ndef producer():\n    for i in range(10):\n        q.put(i)\n        time.sleep(random.uniform(0.01, 0.05))\n    for _ in range(3): q.put(None)  # Sentinel\n\ndef consumer(cid):\n    while True:\n        item = q.get()\n        if item is None:\n            q.put(None)  # Pass sentinel\n            break\n        time.sleep(random.uniform(0.02, 0.05))\n        with lock:\n            results.append((cid, item))\n        q.task_done()\n\nthreads = [threading.Thread(target=producer)] + [threading.Thread(target=consumer, args=(i,)) for i in range(3)]\nfor t in threads: t.start()\nfor t in threads: t.join()\nprint(f'Processed: {len(results)} items')"
    },

    {
        "id": "api_01_rest_client",
        "category": "api_integration",
        "name": "REST Client with Error Handling",
        "description": "Simple REST client with GET/POST/PUT/DELETE. Raise exception based on status code, add retry logic.",
        "language": "python",
        "note": "Use mock HTTP server",
        "expected_methods": ["GET", "POST", "PUT", "DELETE"],
        "timeout_sec": 60,
        "difficulty": "medium",
        "reference_solution": "import urllib.request, urllib.error, json, time\n\nclass RESTClient:\n    def __init__(self, base_url, max_retries=3):\n        self.base_url = base_url.rstrip('/')\n        self.max_retries = max_retries\n    \n    def request(self, method, path, data=None):\n        url = f'{self.base_url}{path}'\n        headers = {'Content-Type': 'application/json'}\n        body = json.dumps(data).encode() if data else None\n        \n        for attempt in range(self.max_retries):\n            req = urllib.request.Request(url, data=body, method=method, headers=headers)\n            try:\n                with urllib.request.urlopen(req, timeout=5) as resp:\n                    return resp.status, json.loads(resp.read().decode())\n            except urllib.error.HTTPError as e:\n                if e.code >= 500 and attempt < self.max_retries - 1:\n                    time.sleep(0.5 * (attempt + 1))\n                    continue\n                return e.code, json.loads(e.read().decode()) if e.read() else {}\n            except Exception:\n                if attempt == self.max_retries - 1: raise\n                time.sleep(0.5 * (attempt + 1))\n        return 500, {'error': 'Max retries exceeded'}"
    },

    {
        "id": "stuck_01_infinite_loop_risk",
        "category": "stuck_detection",
        "name": "Infinite Loop Risk - While True without Break",
        "description": "Loop reading user input until 'quit'. Add max 100 iteration safety guard.",
        "language": "python",
        "test_input": ["cmd1", "cmd2", "quit"],
        "expected_iterations": 3,
        "max_allowed_iterations": 100,
        "timeout_sec": 30,
        "difficulty": "easy",
        "reference_solution": "def interactive_loop(max_iterations=100):\n    commands = []\n    for i in range(max_iterations):\n        try:\n            cmd = input('> ').strip()\n        except EOFError:\n            break\n        if cmd.lower() == 'quit':\n            break\n        commands.append(cmd)\n        print(f'Echo: {cmd}')\n    else:\n        print(f'Max iterations ({max_iterations}) reached, exiting')\n    return commands\n\nimport sys, io\nsys.stdin = io.StringIO('cmd1\\ncmd2\\nquit\\n')\nprint(interactive_loop(100))"
    },
    {
        "id": "stuck_02_repeated_failure",
        "category": "stuck_detection",
        "name": "Retry with Circuit Breaker",
        "description": "Retry failed operation, after 3 failures open circuit breaker and stop. Reset on success.",
        "language": "python",
        "test_scenario": "first_2_fail_then_succeed",
        "expected_behavior": "Succeed on 3rd attempt, circuit breaker should not open",
        "timeout_sec": 30,
        "difficulty": "medium",
        "reference_solution": "import time\n\nclass CircuitBreaker:\n    def __init__(self, failure_threshold=3, recovery_timeout=5):\n        self.failure_count = 0\n        self.failure_threshold = failure_threshold\n        self.recovery_timeout = recovery_timeout\n        self.last_failure_time = None\n        self.state = 'closed'\n    \n    def call(self, func, *args, **kwargs):\n        if self.state == 'open':\n            if time.time() - self.last_failure_time > self.recovery_timeout:\n                self.state = 'half-open'\n            else:\n                raise Exception('Circuit breaker OPEN')\n        try:\n            result = func(*args, **kwargs)\n            self.on_success()\n            return result\n        except Exception as e:\n            self.on_failure()\n            raise\n    \n    def on_success(self):\n        self.failure_count = 0\n        self.state = 'closed'\n    \n    def on_failure(self):\n        self.failure_count += 1\n        self.last_failure_time = time.time()\n        if self.failure_count >= self.failure_threshold:\n            self.state = 'open'\n\ncb = CircuitBreaker(3, 5)\nattempts = 0\ndef flaky_func():\n    global attempts\n    attempts += 1\n    if attempts <= 2: raise Exception('Temporary failure')\n    return 'success'\n\nfor i in range(5):\n    try:\n        print(f'Attempt {i+1}: {cb.call(flaky_func)}')\n    except Exception as e:\n        print(f'Attempt {i+1}: Failed - {e}')"
    },
    {
        "id": "stuck_03_progress_stall",
        "category": "stuck_detection",
        "name": "Progress Tracking with Stall Detection",
        "description": "Long-running task reports progress percentage. If no progress for 30 seconds, alert 'stalled' and stop.",
        "language": "python",
        "test_scenario": "simulate_slow_then_stall",
        "expected_behavior": "Progress reported, stall detected and stopped",
        "timeout_sec": 60,
        "difficulty": "hard",
        "reference_solution": "import time, threading\n\nclass ProgressTracker:\n    def __init__(self, stall_timeout=30):\n        self.progress = 0\n        self.last_progress_time = time.time()\n        self.stall_timeout = stall_timeout\n        self._monitor_thread = None\n        self.running = False\n    \n    def start(self):\n        self.running = True\n        self._monitor_thread = threading.Thread(target=self._monitor, daemon=True)\n        self._monitor_thread.start()\n    \n    def update(self, value):\n        self.progress = value\n        self.last_progress_time = time.time()\n    \n    def _monitor(self):\n        while self.running:\n            time.sleep(1)\n            if time.time() - self.last_progress_time > self.stall_timeout:\n                print(f'STALLED! No progress for {self.stall_timeout}s at {self.progress}%')\n                self.running = False\n                break\n    \n    def stop(self):\n        self.running = False\n        if self._monitor_thread:\n            self._monitor_thread.join(timeout=1)\n\ntracker = ProgressTracker(5)\ntracker.start()\nfor i in range(10):\n    tracker.update(i * 10)\n    time.sleep(0.5)\ntime.sleep(6)\ntracker.stop()"
    }
]

if __name__ == '__main__':
    import json
    print(json.dumps(BENCHMARK_TASKS, indent=2, ensure_ascii=False))