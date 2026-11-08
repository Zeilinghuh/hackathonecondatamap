"""Speech session limits/validation; no microphone or model download required."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

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

    def FinalResult(self):
        return '{"text":"final words"}'


class SpeechTests(unittest.TestCase):
    def test_invalid_sessions_and_odd_pcm_rejected_before_model_loading(self):
        service = SpeechService()
        for session, audio in [("bad", b"\0\0"), ("a" * 32, b"\0")]:
            with self.assertRaises(ValueError):
                service.feed(session, audio)
        self.assertIsNone(service.model)

    def test_whisper_buffers_until_release_and_transcribes_once(self):
        service = SpeechService()
        audio = b"\1\0" * 16000
        with (
            patch.object(
                service, "status", return_value={"ready": True, "whisper": True}
            ),
            patch.object(
                service, "transcribe", return_value="simulate Chelsea in 2030"
            ) as transcribe,
        ):
            self.assertFalse(service.feed("a" * 32, audio)["final"])
            self.assertFalse(service.feed("a" * 32, audio)["final"])
            transcribe.assert_not_called()
            self.assertEqual(
                service.feed("a" * 32, b"", finish=True),
                {"text": "simulate Chelsea in 2030", "final": True},
            )
            transcribe.assert_called_once_with(audio + audio)
            self.assertFalse(service.sessions)
            for _ in range(60):
                service.feed("b" * 32, audio)
            with self.assertRaises(ValueError):
                service.feed("b" * 32, audio)
            self.assertFalse(service.sessions)

    def test_whisper_reuses_cpu_model_without_runtime_downloads(self):
        service = SpeechService()
        engine = Mock()
        engine.transcribe.side_effect = lambda *args, **kwargs: (
            iter([SimpleNamespace(text="Chelsea in 2030")]),
            None,
        )
        constructor = Mock(return_value=engine)
        with patch.dict(
            sys.modules, faster_whisper=SimpleNamespace(WhisperModel=constructor)
        ):
            for _ in range(2):
                self.assertEqual(service.transcribe(b"\1\0" * 1600), "Chelsea in 2030")
        constructor.assert_called_once()
        self.assertTrue(constructor.call_args.kwargs["local_files_only"])
        self.assertEqual(constructor.call_args.kwargs["compute_type"], "int8")
        self.assertIn("Chelsea", engine.transcribe.call_args.kwargs["initial_prompt"])
        self.assertEqual(service.transcribe(bytes(3200)), "")

    def test_streaming_session_reuse_limits_expiry_and_close(self):
        service = SpeechService()
        fake = SimpleNamespace(
            KaldiRecognizer=Recognizer,
            Model=lambda path: object(),
            SetLogLevel=lambda level: None,
        )
        with (
            patch.dict(sys.modules, vosk=fake),
            patch.object(service, "status", return_value={"ready": True}),
            patch("capri.speech.time.monotonic", return_value=100),
        ):
            self.assertEqual(
                service.feed("a" * 32, b"\0\0"), {"text": "hey", "final": False}
            )
            self.assertEqual(
                service.feed("a" * 32, b"\1\0"), {"text": "hey capri", "final": True}
            )
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
