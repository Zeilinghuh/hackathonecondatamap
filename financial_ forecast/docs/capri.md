# Capri

Capri is the map's animated companion and chat assistant. Start the existing
terrain API to serve both the map and chat:

```powershell
python src/backend/server.py
```

The browser's `frontend/GUI/capri.js` controls the gently roaming orb, sprite frames,
dragging, cursor nudges, character pop-out and talking animation. Click the orb
or focus it and press Enter to chat. Drag it aside, or use its arrow keys to
reposition it. A fast cursor sweep nudges it; a slow approach lets you click.
Escape closes chat. Reduced-motion preferences stop floating and frame cycling.
The mouth animation accompanies typed replies; this version does not generate
audio. Opening chat or animating Capri does not send requests to an AI model.

After selecting an authority, **Ask Capri to explain** in the side panel opens
chat and submits a question about that area. It sends the selected authority
code; the server looks up its income observation in the native context index.
Hovering or selecting alone does not request AI. The button is disabled while
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
