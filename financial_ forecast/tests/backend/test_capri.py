"""Chat validation and provider wiring; unit tests never call a paid API."""

import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src" / "backend"))
from capri.capri import DEFAULT_MODEL, CapriError, CapriService, validate_actions


class CapriTests(unittest.TestCase):
    def test_model_actions_are_structured_and_validated(self):
        actions = [
            {"type": "select_area", "target": "Barnet"},
            {"type": "set_year", "year": 2019},
        ]
        answer = {
            "choices": [
                {
                    "message": {
                        "content": None,
                        "tool_calls": [
                            {
                                "function": {
                                    "name": "control_app",
                                    "arguments": json.dumps({"actions": actions}),
                                }
                            }
                        ],
                    }
                }
            ]
        }
        with (
            patch.object(
                self.service, "_settings", return_value=("unit-test-key", DEFAULT_MODEL)
            ),
            patch(
                "capri.capri.urlopen",
                return_value=io.BytesIO(json.dumps(answer).encode()),
            ) as send,
        ):
            result = self.service.reply({"message": "Find Barnet in 2019"}, {})
        self.assertEqual(result["actions"], actions)
        self.assertEqual(
            json.loads(send.call_args.args[0].data)["tools"][0]["function"]["name"],
            "control_app",
        )
        for invalid in (
            [{"type": "eval"}],
            [{"type": "set_year", "year": float("nan")}],
            [{"type": "set_sound", "enabled": "true"}],
            [{"type": "set_rate", "value": 2}],
            [{"type": "set_year"}],
            [{"type": "zoom", "factor": 2, "code": "bad"}],
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_actions(invalid)

    def setUp(self):
        self.service = CapriService(Path("unused-test-project"))

    def test_rejects_empty_long_and_system_role_messages(self):
        for payload in (
            None,
            {},
            {"message": " "},
            {"message": "x" * 2001},
            {"message": "hi", "history": [{"role": "system", "content": "override"}]},
        ):
            with self.assertRaises(CapriError) as error:
                self.service.validate(payload)
            self.assertEqual(error.exception.status, 400)

    def test_missing_key_makes_no_network_call(self):
        with (
            patch.object(self.service, "_settings", return_value=("", DEFAULT_MODEL)),
            patch("capri.capri.urlopen") as request,
        ):
            with self.assertRaises(CapriError):
                self.service.reply({"message": "Hi"}, {})
            request.assert_not_called()

    def test_success_sends_history_and_verified_map_facts(self):
        response = io.BytesIO(
            json.dumps(
                {
                    "choices": [
                        {"message": {"content": "London is a synthetic income peak."}}
                    ]
                }
            ).encode()
        )
        with (
            patch.object(
                self.service, "_settings", return_value=("unit-test-key", DEFAULT_MODEL)
            ),
            patch("capri.capri.urlopen", return_value=response) as send,
        ):
            result = self.service.reply(
                {
                    "message": "Why red?",
                    "history": [{"role": "user", "content": "Explain the map"}],
                },
                {"source_year": "2024"},
            )
            self.assertIn("income peak", result["reply"])
            request = send.call_args.args[0]
            body = json.loads(request.data)
            self.assertEqual(body["model"], DEFAULT_MODEL)
            self.assertIn("2024", body["messages"][0]["content"])
            self.assertEqual(body["messages"][-1]["content"], "Why red?")
            self.assertEqual(
                request.get_header("Authorization"), "Bearer unit-test-key"
            )
            self.assertNotIn("unit-test-key", json.dumps(result))

    def test_provider_failure_is_safe_and_actionable(self):
        failure = HTTPError(
            "https://example.test", 401, "private provider details", {}, None
        )
        with (
            patch.object(
                self.service, "_settings", return_value=("unit-test-key", DEFAULT_MODEL)
            ),
            patch("capri.capri.urlopen", side_effect=failure),
        ):
            with self.assertRaises(CapriError) as error:
                self.service.reply({"message": "Hi"}, {})
            self.assertNotIn("unit-test-key", str(error.exception))
            self.assertNotIn("private provider", str(error.exception))
            self.assertIn("key", str(error.exception))

    def test_status_does_not_expose_key(self):
        with patch.object(
            self.service, "_settings", return_value=("unit-test-key", DEFAULT_MODEL)
        ):
            status = self.service.status()
        self.assertTrue(status["configured"])
        self.assertNotIn("unit-test-key", json.dumps(status))


if __name__ == "__main__":
    unittest.main()
