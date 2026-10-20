from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from run_evaluation import CodeExecutor, EvaluationResult, StuckDetectionConfig, UltronEvalRunner
from benchmarks import BENCHMARK_TASKS


class TestCodeExecutor(unittest.TestCase):
    def setUp(self):
        self.executor = CodeExecutor(timeout_sec=30)
    
    def test_simple_execution(self):
        code = "print('hello world')"
        result = self.executor.execute(code)
        self.assertTrue(result['success'])
        self.assertIn('hello world', result['output'])
    
    def test_syntax_error(self):
        code = "print('missing quote)"
        result = self.executor.execute(code)
        self.assertFalse(result['success'])
        self.assertIn('SyntaxError', result['output'] + result.get('stderr', ''))
    
    def test_runtime_error(self):
        code = "x = 1 / 0"
        result = self.executor.execute(code)
        self.assertFalse(result['success'])
        self.assertIn('ZeroDivisionError', result['output'] + result.get('stderr', ''))
    
    def test_timeout(self):
        code = "import time; time.sleep(10)"
        result = self.executor.execute(code, timeout_sec=1)
        self.assertFalse(result['success'])
        self.assertTrue(result.get('timeout', False))
    
    def test_stdin_input(self):
        code = "import sys; data = sys.stdin.read(); print(f'Got: {data.strip()}')"
        result = self.executor.execute(code, stdin_input="test input")
        self.assertTrue(result['success'])
        self.assertIn('Got: test input', result['output'])


class TestStuckDetection(unittest.TestCase):
    def setUp(self):
        self.config = StuckDetectionConfig(max_duration_sec=5, max_no_progress_sec=2)
        self.runner = UltronEvalRunner(self.config)
    
    def test_timeout_detection(self):
        result = {'output': '', 'stdout': '', 'stderr': ''}
        stuck, reason = self.runner.detect_stuck(result, 10.0)  # 10s > 5s max
        self.assertTrue(stuck)
        self.assertIn('Max duration', reason)
    
    def test_repeated_traceback_detection(self):
        result = {'output': 'Traceback\n' * 6}
        stuck, reason = self.runner.detect_stuck(result, 1.0)
        self.assertTrue(stuck)
        self.assertIn('traceback', reason.lower())
    
    def test_stuck_keywords(self):
        for keyword in ['infinite loop', 'stuck', 'deadlock', 'hanging']:
            result = {'output': f'Process {keyword} detected'}
            stuck, _ = self.runner.detect_stuck(result, 1.0)
            self.assertTrue(stuck, f"Should detect '{keyword}'")


class TestErrorClassification(unittest.TestCase):
    def setUp(self):
        self.runner = UltronEvalRunner()
    
    def test_syntax_error(self):
        result = {'stderr': 'SyntaxError: invalid syntax', 'stdout': ''}
        self.assertEqual(self.runner.classify_error(result), 'syntax')
    
    def test_indentation_error(self):
        result = {'stderr': 'IndentationError: unexpected indent', 'stdout': ''}
        self.assertEqual(self.runner.classify_error(result), 'syntax')
    
    def test_runtime_errors(self):
        for err in ['NameError', 'AttributeError', 'TypeError', 'KeyError', 'IndexError', 'ValueError']:
            result = {'stderr': f'{err}: something went wrong', 'stdout': ''}
            self.assertEqual(self.runner.classify_error(result), 'runtime', f"Failed for {err}")
    
    def test_timeout_error(self):
        result = {'stderr': 'TimeoutException', 'stdout': ''}
        self.assertEqual(self.runner.classify_error(result), 'timeout')
        result2 = {'stdout': 'EXECUTION_TIMEOUT'}
        self.assertEqual(self.runner.classify_error(result2), 'timeout')
    
    def test_success_no_error(self):
        result = {'success': True, 'stdout': 'hello', 'stderr': ''}
        self.assertEqual(self.runner.classify_error(result), 'logic')


class TestBenchmarks(unittest.TestCase):
    def test_benchmarks_structure(self):
        for task in BENCHMARK_TASKS:
            # Required fields
            self.assertIn('id', task)
            self.assertIn('name', task)
            self.assertIn('category', task)
            self.assertIn('description', task)
            self.assertIn('language', task)
            self.assertIn('timeout_sec', task)
            self.assertIn('difficulty', task)
            
            # Valid category
            self.assertIn(task['category'], [
                'basic_algorithms', 'error_handling', 'file_operations',
                'async_concurrency', 'api_integration', 'stuck_detection'
            ])
            
            # Valid difficulty
            self.assertIn(task['difficulty'], ['easy', 'medium', 'hard'])
            
            # Timeout reasonable
            self.assertGreater(task['timeout_sec'], 0)
            self.assertLessEqual(task['timeout_sec'], 300)
    
    def test_categories_covered(self):
        categories = {t['category'] for t in BENCHMARK_TASKS}
        expected = {'basic_algorithms', 'error_handling', 'file_operations', 
                      'async_concurrency', 'api_integration', 'stuck_detection'}
        self.assertEqual(categories, expected)
    
    def test_difficulty_distribution(self):
        diffs = [t['difficulty'] for t in BENCHMARK_TASKS]
        self.assertIn('easy', diffs)
        self.assertIn('medium', diffs)
        self.assertIn('hard', diffs)


class TestEvaluationResult(unittest.TestCase):
    def test_result_serialization(self):
        result = EvaluationResult(
            task_id='test_01',
            task_name='Test Task',
            category='basic_algorithms',
            success=True,
            duration_sec=1.5,
            model_turns=1,
            tool_calls=0,
            correction_attempts=0,
            stuck_detected=False,
            stuck_reason='',
            error_type='',
            error_message='',
            output='test output',
            expected_output='expected',
            generated_code='print("hello")',
            metrics={'generation_time': 0.5}
        )
        
        # Should be serializable to dict
        data = asdict(result)
        self.assertEqual(data['task_id'], 'test_01')
        self.assertTrue(data['success'])
        
        # JSON serializable
        json_str = json.dumps(data)
        self.assertIn('test_01', json_str)


def asdict(obj):
    """Simple dataclass to dict"""
    if hasattr(obj, '__dataclass_fields__'):
        return {f: getattr(obj, f) for f in obj.__dataclass_fields__}
    return obj.__dict__


if __name__ == '__main__':
    unittest.main()