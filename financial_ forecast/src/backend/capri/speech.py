"""Bounded local push-to-talk: Whisper small.en, with legacy Vosk fallback."""

import importlib.util
import json
import os
import re
import threading
import time
from pathlib import Path

MODEL_NAME = "vosk-model-small-en-us-0.15"
MODEL_ROOT = Path(__file__).resolve().parents[3] / "build" / "speech"
MODEL_FILES = ("am/final.mdl", "graph/HCLr.fst", "graph/Gr.fst", "conf/mfcc.conf")
WHISPER_ROOT = MODEL_ROOT / "faster-whisper-small.en"
WHISPER_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")


class SpeechService:
    def __init__(self):
        self.model = None
        self.whisper = None
        self.sessions = {}
        self.lock = threading.Lock()
        self.inference_lock = threading.Lock()

    def status(self):
        whisper = bool(
            importlib.util.find_spec("faster_whisper")
            and all((WHISPER_ROOT / name).is_file() for name in WHISPER_FILES)
        )
        vosk = bool(
            importlib.util.find_spec("vosk")
            and all((MODEL_ROOT / MODEL_NAME / name).is_file() for name in MODEL_FILES)
        )
        return {
            "ready": whisper or vosk,
            "provider": "local",
            "cloud": False,
            "model": "Whisper small.en" if whisper else MODEL_NAME,
            "whisper": whisper,
        }

    def feed(self, session, audio, finish=False):
        if (
            not re.fullmatch(r"[a-f0-9]{32}", session)
            or len(audio) % 2
            or len(audio) > 32000
        ):
            raise ValueError("Invalid speech session or PCM audio.")
        with self.lock:
            now = time.monotonic()
            self.sessions = {
                key: value
                for key, value in self.sessions.items()
                if now - value[1] < 30
            }
            if session not in self.sessions:
                if len(self.sessions) >= 4:
                    raise ValueError(
                        "Too many voice sessions. Close an unused tab and retry."
                    )
                status = self.status()
                if not status["ready"]:
                    raise ValueError("Local voice is not installed. See docs/capri.md.")
                if status.get("whisper"):
                    engine = bytearray()
                else:
                    from vosk import KaldiRecognizer, Model, SetLogLevel

                    if self.model is None:
                        SetLogLevel(-1)
                        self.model = Model(str(MODEL_ROOT / MODEL_NAME))
                    engine = KaldiRecognizer(self.model, 16000)
                self.sessions[session] = (engine, now)
            engine, _ = self.sessions[session]
            self.sessions[session] = (engine, now)
            if isinstance(engine, bytearray):
                if len(engine) + len(audio) > 16000 * 2 * 60:
                    self.sessions.pop(session, None)
                    raise ValueError("Recording limit reached. Hold to speak again.")
                engine.extend(audio)
                if not finish:
                    return {"text": "", "final": False, "model": "Whisper small.en"}
                self.sessions.pop(session, None)
                pcm = bytes(engine)
            else:
                if finish:
                    if audio:
                        engine.AcceptWaveform(audio)
                    result = json.loads(engine.FinalResult())
                    self.sessions.pop(session, None)
                    return {"text": result.get("text", ""), "final": True}
                final = bool(engine.AcceptWaveform(audio))
                result = json.loads(
                    engine.Result() if final else engine.PartialResult()
                )
                return {
                    "text": result.get("text" if final else "partial", ""),
                    "final": final,
                }
        # The microphone is already stopped; inference must not lock other captures.
        return {"text": self.transcribe(pcm), "final": True}

    def transcribe(self, pcm):
        if len(pcm) < 3200 or not any(pcm):
            return ""
        import numpy as np
        from faster_whisper import WhisperModel

        samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        with self.inference_lock:
            if self.whisper is None:
                self.whisper = WhisperModel(
                    str(WHISPER_ROOT),
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=4,
                    local_files_only=True,
                )
            segments, _ = self.whisper.transcribe(
                samples,
                language="en",
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=False,
                temperature=0,
                initial_prompt="CAPRICORN UK economic map. Capri, Barnet, Kensington and Chelsea, Westminster, income per head, population density, employment rate, weekly pay, foreign investment, 2019, 2030.",
            )
            return " ".join(segment.text.strip() for segment in segments).strip()[:2000]

    def close(self, session):
        with self.lock:
            self.sessions.pop(session, None)


def install_model():
    # This explicit setup command downloads model weights; HTTP requests never do.
    if all((MODEL_ROOT / MODEL_NAME / name).is_file() for name in MODEL_FILES):
        print("Local English speech model already installed.")
        return
    import tempfile
    import zipfile
    from urllib.request import urlopen

    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryFile() as archive:
        with urlopen(
            f"https://alphacephei.com/vosk/models/{MODEL_NAME}.zip", timeout=45
        ) as response:
            total = 0
            while block := response.read(1024 * 1024):
                total += len(block)
                if total > 64 * 1024 * 1024:
                    raise ValueError("Speech model download exceeds expected size.")
                archive.write(block)
        archive.seek(0)
        with zipfile.ZipFile(archive) as zipped:
            if sum(info.file_size for info in zipped.infolist()) > 128 * 1024 * 1024:
                raise ValueError("Speech model archive exceeds expected size.")
            for name in zipped.namelist():
                target = (MODEL_ROOT / name).resolve()
                if not target.is_relative_to(
                    MODEL_ROOT.resolve()
                ) or not name.startswith(MODEL_NAME + "/"):
                    raise ValueError("Invalid path in speech model archive.")
            zipped.extractall(MODEL_ROOT)
    print("Local English speech model ready.")


def install_whisper():
    """Explicit setup only: runtime requests never download model files."""
    os.environ.setdefault("HF_HOME", str(MODEL_ROOT / "huggingface"))
    from huggingface_hub import snapshot_download

    snapshot_download(
        "Systran/faster-whisper-small.en",
        local_dir=WHISPER_ROOT,
        allow_patterns=list(WHISPER_FILES),
    )
    print("Local Whisper small.en voice model ready.")


if __name__ == "__main__":
    install_whisper()
