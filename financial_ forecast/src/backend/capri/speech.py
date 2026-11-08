"""Bounded, offline speech sessions backed by Vosk's native recognizer."""

import importlib.util
import json
from pathlib import Path
import re
import threading
import time

MODEL_NAME = "vosk-model-small-en-us-0.15"
MODEL_ROOT = Path(__file__).resolve().parents[3] / "build" / "speech"
MODEL_FILES = ("am/final.mdl", "graph/HCLr.fst", "graph/Gr.fst", "conf/mfcc.conf")


class SpeechService:
    def __init__(self):
        self.model = None
        self.sessions = {}
        self.lock = threading.Lock()

    def status(self):
        return {"ready": bool(importlib.util.find_spec("vosk") and all((MODEL_ROOT / MODEL_NAME / name).is_file() for name in MODEL_FILES))}

    def feed(self, session, audio, finish=False):
        if not re.fullmatch(r"[a-f0-9]{32}", session) or len(audio) % 2:
            raise ValueError("Invalid speech session or PCM audio.")
        with self.lock:
            now = time.monotonic()
            self.sessions = {key: value for key, value in self.sessions.items() if now - value[1] < 30}
            if session not in self.sessions:
                if len(self.sessions) >= 4:
                    raise ValueError("Too many voice sessions. Close an unused tab and retry.")
                if not self.status()["ready"]:
                    raise ValueError("Local voice is not installed. See docs/capri.md.")
                from vosk import KaldiRecognizer, Model, SetLogLevel

                if self.model is None:
                    SetLogLevel(-1)
                    self.model = Model(str(MODEL_ROOT / MODEL_NAME))
                self.sessions[session] = (KaldiRecognizer(self.model, 16000), now)
            recognizer, _ = self.sessions[session]
            self.sessions[session] = (recognizer, now)
            if finish:
                if audio:
                    recognizer.AcceptWaveform(audio)
                final = True
                result = json.loads(recognizer.FinalResult())
            else:
                final = bool(recognizer.AcceptWaveform(audio))
                result = json.loads(recognizer.Result() if final else recognizer.PartialResult())
            return {"text": result.get("text" if final else "partial", ""), "final": final}

    def close(self, session):
        with self.lock:
            self.sessions.pop(session, None)


def install_model():
    # This explicit setup command downloads model weights; HTTP requests never do.
    if all((MODEL_ROOT / MODEL_NAME / name).is_file() for name in MODEL_FILES):
        print("Local English speech model already installed.")
        return
    import tempfile
    from urllib.request import urlopen
    import zipfile

    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryFile() as archive:
        with urlopen(f"https://alphacephei.com/vosk/models/{MODEL_NAME}.zip", timeout=45) as response:
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
                if not target.is_relative_to(MODEL_ROOT.resolve()) or not name.startswith(MODEL_NAME + "/"):
                    raise ValueError("Invalid path in speech model archive.")
            zipped.extractall(MODEL_ROOT)
    print("Local English speech model ready.")


if __name__ == "__main__":
    install_model()
