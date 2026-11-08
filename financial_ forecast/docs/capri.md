# Capri

Sound effects are controlled by SFX ON/OFF in the map navigation; the preference is remembered. Buttons, sliders and area selections use cached CC0 Kenney samples, and orb wall hits vary their sound with impact speed. Capri's text animation drives original synthesized vowel chatter. Effects are silenced during microphone capture and while the tab is hidden. Sources and licence are in `src/frontend/GUI/assets/sfx/`. Audio stays in the existing GUI controls module.

Map legends share a vertical, scrollable stack above the speak control, so mist and a data-layer legend remain separate. Timeline playback advances every 650 ms, with a 550 ms GPU transition during Play.

Hold **Speak to Capri** at the bottom left, speak, then release to convert and send the question. Space or Enter works while the button is focused. Releasing stops microphone capture immediately and flushes the remaining audio before sending. Releasing before the microphone is ready, cancelling the gesture, leaving the tab or closing chat cancels capture. There is no wake phrase, ambient listening, browser speech-service fallback or automatic restart. Typed drafts remain intact.

The frontend is grouped under `src/frontend/GUI/capri/`:

- `capri.js`: chat, draggable window, orb movement/idle animations and area actions.
- `actions.js`: validated application controls, regional camera focus and execution receipts from displayed data.
- `voice.js`: push-to-talk capture and submission.
- `voiceprocessor.js`: the separate browser AudioWorklet, converting audio to bounded 16 kHz PCM chunks.

The backend remains `src/backend/capri/capri.py` for AI chat and `speech.py` for native local transcription. The voice engine is kept separate because it manages model loading and audio sessions, not chat prompts. Set up voice from the repository root with `uv sync --no-dev --extra voice`, then `uv run --no-dev --extra voice python "financial_ forecast/src/backend/capri/speech.py"`. Start the server using the same voice extra. Whisper small.en weights (roughly 500 MB) stay in ignored `build/speech/`; inference runs on CPU with int8 precision and microphone audio is not saved. The first transcription loads the model; later questions reuse it. An existing Vosk model remains an offline fallback when Whisper has not been installed. Setup downloads are explicit; requests never download models. Legacy Fireworks Whisper endpoints failed live availability checks for this account, so transcription runs locally and requires no additional API key. Model source: https://huggingface.co/Systran/faster-whisper-small.en .

Capri can select/focus an authority, change years, switch layers/views, control
playback/zoom/sidebar/sound and edit simulations. All typed/spoken requests go to
the chat model with current metric, camera, scenario inputs and recent history.
The model chooses allowlisted actions through existing app controls.
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

The default is `accounts/fireworks/models/kimi-k3`, with medium reasoning effort,
validated app tool calls and the available authority names supplied as context.
Override it with `CAPRI_MODEL` in `.env`. The local configuration was upgraded
from the lightweight Nemotron model and verified against the Chelsea 2030 request.
The model resolves place names and metric/scope/year intent using the available
authorities and current app state. No client-side phrase parser chooses actions.

- `GET /api/capri/status`: whether a server key is configured (never the key).
- `POST /api/capri/chat`: message, bounded conversation history and optionally
  the selected authority code. The server resolves actual map facts itself.
- `GET /capri-assets/sprites.png`: the generated transparent sprite sheet.

Only a submitted message triggers a provider request. The provider receives
the message, recent conversation and a small verified map summary, including
the selected authority's economic observation when available. Source files and
credentials are not included. Chat is held only in page memory. Refresh/reopening the page starts a fresh conversation; closing and reopening the chat window on the same page preserves context. Up to 12 recent messages within a 14,000-character budget are sent for context. The old saved-chat storage key is removed automatically.
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

Requested app operations use validated control calls, including explicit recorded/simulation mode switching and visible scenario edits. Camera focus runs after the requested layer, year and mode are applied, with an eased pan/zoom to the actual raised 3D position. User input cancels a flight. Manual year scrubbing and scenario edits retarget the shared terrain animation. Apply was removed because scenario controls auto-apply.

Capri can call the server-side lookup_data tool for another authority/year without changing the map. Simulation context includes calculated per-area series, no-shock baselines, absolute/percentage scenario differences, units, the feedback matrix and labelled national summaries. Lookups use server-generated data, never client-supplied numeric claims; unavailable observations remain missing.

For example, “change the parameters to find minimum income per head in London” invokes optimize_simulation, defaults to 2028, searches actual model results, applies the winning scenario visually and highlights its borough. Growth-shock controls accept -10 to +10; the separate rate stance remains -1 to +1.

## Action, feedback and explanation

The chat model plans actions with tool calls. A bounded, server-held continuation
retains those calls and reasoning while the browser applies them. The browser
then returns an execution receipt; the server recomputes current verified map
facts before asking the model to finish the user's request. This permits camera
movement, parameter changes, result inspection and an explanation in one turn.
Errors can be corrected by another model-selected action, with a four-action-round
limit. Pending continuations expire after five minutes and are capped at 32.

The latest explicit metric overrides earlier conversation/current-layer context.
There are no keyword-triggered scenarios. `focus_region` frames a region or UK;
`optimize_simulation` supports `aggregation=extreme` for an authority extreme and
`aggregation=mean` for a region-wide unweighted mean. The latter avoids confusing
a low-value borough with a whole-country objective. Scenario and model limitations
remain explicit, and statements use post-execution facts. Qualitative goals are
interpreted by the model, which explains assumptions or asks when ambiguous.

## Live time and position

Each request includes fresh server UTC and local time calculated from the
browser's current timezone offset. Capri can answer time/date questions without
relying on training data. Browser timezone is a setting, not evidence of physical
location. The camera target supplies current map coordinates.

`show_map_position` pins the current viewed map point. `locate_user` uses a
one-shot browser Geolocation request when asked to locate the device; permission
is required. Coordinates, accuracy and observation time become available to Capri
after success. The map shows an approximate device pin, planning authority when
matched, and accuracy in the stacked legend. Pins reproject with camera movement,
2D/3D and terrain changes. Denial/timeouts are reported; positions outside UK map
bounds are described without miscentring the UK map. There is no background
location watch or IP-based location guess. Device coordinates are held in page
memory until reload and included in chat context after an explicit location
request; the current page conversation may contain the resulting explanation.

The unfinished 'Spawn 100 clouds' menu item is removed. No cloud-spawning control
or general web-search capability is advertised.

Pin removal uses one clearLocation operation for Capri and the × button on the location legend. It removes the marker and legend, clears stored device coordinates and any selection belonging to that pin, and invalidates pending location callbacks. A late browser location result cannot recreate a cleared pin. The model receives explicit pin/marker/legend visibility state after each action.
