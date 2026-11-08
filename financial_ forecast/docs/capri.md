# Capri

The map's MIC OFF button enables wake-word listening in English (UK). Say “Hey Capri” followed by a question: Capri opens chat, then automatically sends finalized speech after a 1.2-second pause or recognition ending. Saying only the wake phrase opens chat without submitting an empty question. MUTE MIC stops capture and discards pending speech immediately. Typed drafts are preserved when voice sends a question.

Voice prefers the local Vosk service when installed. Browser microphone audio is converted to 16 kHz mono PCM in an AudioWorklet and sent in bounded half-second chunks to the local server, where the native recognizer keeps one model in memory. Audio is not written to disk. Sessions expire after 30 seconds idle, with at most four active sessions. Muting closes capture and deletes the session. Browser speech recognition is a fallback; it may process audio online. Local browser speech packs are preferred when that fallback exposes a usable English model. Voice needs localhost or HTTPS. Hidden tabs and Capri's replies pause capture. Closing chat cancels the current question but leaves wake-word mode enabled. Permission/service errors switch listening off with a retry message. Capri replies in text with her talking animation.

Setup from the repository root: `uv sync --no-dev --extra voice`, then `uv run --no-dev --extra voice python "financial_ forecast/src/backend/capri/speech.py"`. This explicit command downloads the official English model once; HTTP requests never download it. Start the server with the same `--extra voice`. Weights stay in ignored `build/speech/`. Model source/license: https://alphacephei.com/vosk/models (small English 0.15, Apache 2.0).

The UI shows Starting until the engine confirms readiness, then a listening indicator and a Heard transcript. Wake matching accepts common variants (Capree, Cap Ree, coppery), punctuation and a wake phrase split across recognition sessions. Empty or unrelated speech is never submitted. If using browser recognition, an unsupported UK English service retries US English once. Startup timeouts and speech-service errors are displayed instead of leaving a false listening status.

Drag the chat header to reposition it, or focus the header and use arrow keys. Its position is retained during the session and clamped when the map resizes. Voice controls sit outside the message form, whose textarea keeps its own full-width column.

Right-click an area and choose Explain this area for a direct explanation. The duplicate sidebar explanation button has been removed.

Capri is the map's animated companion and chat assistant. Start the existing
terrain API to serve both the map and chat:

```powershell
python src/backend/server.py
```

The browser's `frontend/GUI/capri.js` controls the gently roaming orb, sprite frames,
dragging, cursor nudges, character pop-out and talking animation. Click the orb
or focus it and press Enter to chat. Drag it aside, or use its arrow keys to
reposition it. Drag and release quickly to fling the orb: momentum decays and wall hits bounce. Throws change the actual orb sprite to spiral/crossed eyes; another quick throw produces a scowling face and shake. Reactions last 4.2 seconds, with visible DIZZY or SERIOUSLY? labels. The four-frame reaction strip is `GUI/assets/capri-reactions.svg`; the existing character sheet supplies cursor-watching peeks. Idle peeking occurs after 12–22 seconds, with a small chance of briefly approaching the cursor. Mischief is always enabled; there is no toggle. A fast cursor sweep nudges it; a slow approach lets you click.
Escape closes chat. Reduced-motion preferences stop floating, idle interruptions and frame cycling. Companion updates are capped at 30 Hz and suspended in hidden tabs; frame lists are shared rather than allocated every frame.
The mouth animation accompanies typed replies; this version does not generate
audio. Opening chat or animating Capri does not send requests to an AI model.

Right-clicking an authority and choosing **Explain this area** opens
chat and submits a question about that area. It sends the selected authority
code; the server looks up its income observation in the native context index.
Hovering or selecting alone does not request AI. Further explanations wait while
a reply is being prepared. It works with terrain on or off, in either view.

## Chat connection

`capri.py` uses Fireworks' HTTPS chat-completions endpoint using only Python's
standard library. It does not make a request at import time.

The server reads `FIREWORKS_API_KEY` from the process environment or the existing
`financial_ forecast/.env` file. This file remains ignored by Git and is outside
the publicly served frontend directory. No key is returned to the browser.

The previous Qwen 3 4B Instruct deployment was unavailable when tested. The
default is now `accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b`, a
configured lightweight model. Override it with `CAPRI_MODEL` in `.env`.
An example configuration is provided in the project directory. The integration
was verified with a real chat request using the existing account key.

- `GET /api/capri/status`: whether a server key is configured (never the key).
- `POST /api/capri/chat`: message, bounded conversation history and optionally
  the selected authority code. The server resolves actual map facts itself.
- `GET /capri-assets/sprites.png`: the generated transparent sprite sheet.

Only a submitted message triggers a provider request. The provider receives
the message, recent conversation and a small verified map summary, including
the selected authority's economic observation when available. Source files and
credentials are not included. History lives only in the current browser page.
Errors and provider timeouts appear in chat and allow retrying.

Provider documentation:
https://docs.fireworks.ai/api-reference/post-chatcompletions

Model:
https://fireworks.ai/models/fireworks/nemotron-lightning-3p5-30b-a3b

Sprite provenance, frame layout and generation prompt:
`assets/visual/capri/README.md`.

Tests (mocked provider, no paid requests):

```powershell
python -m unittest discover -s tests/backend -p test_capri.py
```
