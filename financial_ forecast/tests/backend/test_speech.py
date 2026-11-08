"""Speech session limits/validation; no microphone or model download required."""
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src/backend"))
from capri.speech import SpeechService


class Recognizer:
    def __init__(self, model, rate):
        assert rate == 16000

    def AcceptWaveform(self, audio):
        return audio == b"\1\0"

    def Result(self):
        return '{"text":"hey capri"}'

    def PartialResult(self):
        return '{"partial":"hey"}'


class SpeechTests(unittest.TestCase):
    def test_invalid_sessions_and_odd_pcm_rejected_before_model_loading(self):
        service = SpeechService()
        for session, audio in [("bad", b"\0\0"), ("a" * 32, b"\0")]:
            with self.assertRaises(ValueError):
                service.feed(session, audio)
        self.assertIsNone(service.model)

    def test_streaming_session_reuse_limits_expiry_and_close(self):
        service = SpeechService()
        fake = SimpleNamespace(KaldiRecognizer=Recognizer, Model=lambda path: object(), SetLogLevel=lambda level: None)
        with patch.dict(sys.modules, vosk=fake), patch.object(service, "status", return_value={"ready": True}), patch("capri.speech.time.monotonic", return_value=100):
            self.assertEqual(service.feed("a" * 32, b"\0\0"), {"text": "hey", "final": False})
            self.assertEqual(service.feed("a" * 32, b"\1\0"), {"text": "hey capri", "final": True})
            for key in "bcd":
                service.feed(key * 32, b"\0\0")
            with self.assertRaises(ValueError):
                service.feed("e" * 32, b"\0\0")
            with patch("capri.speech.time.monotonic", return_value=131):
                service.feed("e" * 32, b"\0\0")
            self.assertEqual(len(service.sessions), 1)
            service.close("e" * 32)
            self.assertFalse(service.sessions)


if __name__ == "__main__":
    unittest.main()
