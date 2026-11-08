# Capri

Sound effects are controlled by SFX ON/OFF in the map navigation; the preference is remembered. Buttons, sliders and area selections use cached CC0 Kenney samples, and orb wall hits vary their sound with impact speed. Capri's text animation drives original synthesized vowel chatter. Effects are silenced during microphone capture and while the tab is hidden. Sources and licence are in `src/frontend/GUI/assets/sfx/`. Audio stays in the existing GUI controls module.

Map legends share a vertical, scrollable stack above the speak control, so mist and a data-layer legend remain separate. Timeline playback advances every 650 ms, with a 550 ms GPU transition during Play.

Hold **Speak to Capri** at the bottom left, speak, then release to convert and send the question. Space or Enter works while the button is focused. Releasing stops microphone capture immediately and flushes the remaining audio before sending. Releasing before the microphone is ready, cancelling the gesture, leaving the tab or closing chat cancels capture. There is no wake phrase, ambient listening, browser speech-service fallback or automatic restart. Typed drafts remain intact.

The frontend is grouped under `src/frontend/GUI/capri/`:

- `capri.js`: chat, draggable window, orb movement/idle animations and area actions.
- `actions.js`: validated application commands, local navigation parsing and summaries from displayed data.
- `voice.js`: push-to-talk capture and submission.
- `voiceprocessor.js`: the separate browser AudioWorklet, converting audio to bounded 16 kHz PCM chunks.

The backend remains `src/backend/capri/capri.py` for AI chat and `speech.py` for native local transcription. The voice engine is kept separate because it manages model loading and audio sessions, not chat prompts. Set up voice from the repository root with `uv sync --no-dev --extra voice`, then `uv run --no-dev --extra voice python "financial_ forecast/src/backend/capri/speech.py"`. Start the server using the same voice extra. Whisper small.en weights (roughly 500 MB) stay in ignored `build/speech/`; inference runs on CPU with int8 precision and microphone audio is not saved. The first transcription loads the model; later questions reuse it. An existing Vosk model remains an offline fallback when Whisper has not been installed. Setup downloads are explicit; requests never download models. Legacy Fireworks Whisper endpoints failed live availability checks for this account, so transcription runs locally and requires no additional API key. Model source: https://huggingface.co/Systran/faster-whisper-small.en .

Capri can select/focus an authority, change years, switch layers/views, control
playback/zoom/sidebar/sound and edit simulations. “Find Barnet in 2019” works
locally; broader requests use the provider's `control_app` function call. Both
paths execute the same allowlisted actions through existing app controls.
Model-generated actions are checked before they reach the browser, then checked
again before execution; no JavaScript, DOM selectors or shell commands are accepted.
Action replies use the resulting map values. In simulation mode, server chat
context is rebuilt from the applied scenario, including missing coverage and
source years, rather than trusting numbers supplied by a client. See
[simulation details](simulation.md).

Capri uses the original sprite sheet for her orb, character, talking and peeking poses. Fling momentum, bouncing, brief reaction labels and subtle sprite transforms remain; the inconsistent replacement reaction sheet has been removed. Drag the chat header to move it; its position stays within the map. Right-click an area for chat/explanations or comparisons. Idle peeks and occasional mischief remain enabled, respecting reduced-motion preferences.

## Chat connection

`capri.py` uses Fireworks' HTTPS chat-completions endpoint using only Python's
standard library. It does not make a request at import time.

The server reads `FIREWORKS_API_KEY` from the process environment or the existing
`financial_ forecast/.env` file. This file remains ignored by Git and is outside
the publicly served frontend directory. No key is returned to the browser.

The default is `accounts/fireworks/models/kimi-k3`, with low reasoning effort,
validated app tool calls and the available authority names supplied as context.
Override it with `CAPRI_MODEL` in `.env`. The local configuration was upgraded
from the lightweight Nemotron model and verified against the Chelsea 2030 request.
Clear requests such as “Capri simulate income per head in 2030 in Chelsea” also
resolve locally: Chelsea maps to Kensington and Chelsea, then the income layer,
simulation mode and year are applied through the same controls.

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
https://fireworks.ai/models/fireworks/kimi-k3

Sprite provenance, frame layout and generation prompt:
`assets/visual/capri/README.md`.

Tests (mocked provider, no paid requests):

```powershell
python -m unittest discover -s tests/backend -p test_capri.py
```
