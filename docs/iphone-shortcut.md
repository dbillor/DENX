# iPhone Shortcut Setup

This project is designed so a single tap on iPhone records raw audio and sends it straight to your Mac.

Preferred flow:

- Record Audio on the iPhone.
- Optionally connect to Tailscale first.
- Upload the audio file to your Mac.
- Transcribe locally on the Mac with `faster-whisper`.
- Pass the transcript into local Codex.
- Write the result into the Obsidian vault.
- Send an acknowledgment and completion notice by OpenClaw/iMessage.
- Return from the HTTP request immediately while the heavy work continues in the background.

## Before You Start

- Run the server:

  ```bash
  npm run dev:server
  ```

- Confirm the Mac-side agent backend:

  ```bash
  npx tsx src/cli/index.ts doctor
  ```

- Make sure your phone can reach it.
  - Same Wi-Fi network: use your computer's LAN IP and port `8787`.
  - Anywhere access: use Tailscale on both the Mac and iPhone, then point the Shortcut at the Mac's Tailscale IP or MagicDNS name.
- Set `CAPTURE_API_TOKEN` in `.env`.

## Recommended Shortcut: Raw Audio To Mac

Build a Shortcut with these actions in order:

1. `Record Audio`
   - Quality: High
   - Stop listening: On Tap

2. Optional: a Tailscale Shortcuts action such as `Connect`
   - Use this only if the Tailscale app exposes it on your iPhone.
   - Otherwise, keep Tailscale connected in the background.

3. `Current Date`
   - Use the current date as the capture timestamp.

4. Optional: `Format Date`
   - Convert the date to a machine-readable string if you want to pass it explicitly.

5. `Get Contents of URL`
   - URL: `http://YOUR-MAC-IP-OR-TAILSCALE-HOST:8787/api/captures/voice`
   - Method: `POST`
   - Request Body: `File`
   - File: `Recorded Audio`

6. Add request headers:
   - `Authorization`: `Bearer YOUR_CAPTURE_API_TOKEN`
   - `X-Device`: `iPhone Action Button`
   - `X-Captured-At`: `Formatted Date` or `Current Date`
   - `X-File-Name`: `capture.m4a`

7. Optional during debugging: `Quick Look`
   - This shows the accepted JSON response immediately.
   - For production Action Button use, remove this step.

## What The Shortcut Sees Now

The server now returns immediately with `202 Accepted` and JSON like:

```json
{
  "captureId": "cap_1742585560000",
  "status": "queued",
  "queuedAt": "2026-03-21T20:45:00.000Z",
  "statusUrl": "/api/captures/cap_1742585560000"
}
```

That is intentional. The heavy work now happens in the background:

- OpenClaw sends a receipt iMessage when Denx accepts the capture.
- Whisper transcribes locally on the Mac.
- Codex updates the vault.
- OpenClaw sends a completion or failure iMessage afterward.

This avoids the old iPhone timeout behavior where the Shortcut sat waiting for the whole pipeline to finish.

## Recommended Anywhere Setup: Tailscale

Use Tailscale instead of exposing the capture server publicly.

1. Install Tailscale on your Mac.
2. Install Tailscale on your iPhone.
3. Sign into the same Tailscale account on both devices.
4. Confirm the iPhone can reach the Mac over Tailscale.
5. In the Shortcut, use either:
   - the Mac's Tailscale IP, or
   - the Mac's MagicDNS name
6. If the Tailscale app exposes a Shortcuts action, add it near the start of the Shortcut so the tunnel is up before the upload runs.

## Fallback Shortcut: Dictation To Mac

Build a Shortcut with these actions in order:

1. `Dictate Text`
   - Prompt: `Capture idea`
   - Stop listening: On Tap

2. `Current Date`
   - Use the current date as the capture timestamp.

3. `Get Contents of URL`
   - URL: `http://YOUR-MAC-IP:8787/api/captures/text`
   - Method: `POST`
   - Request Body: `Form`

4. In the form body, add these fields:
   - `text`: Dictated Text
   - `device`: `iPhone Action Button`
   - `capturedAt`: Current Date

5. Add request headers:
   - `Authorization`: `Bearer YOUR_CAPTURE_API_TOKEN`

6. Optional during debugging: `Quick Look`
   - Remove this in production if you want a quieter Action Button flow.

## Response Shape

The status endpoint or debug response returns JSON like:

```json
{
  "captureId": "cap_1742585560000",
  "state": "completed",
  "queuedAt": "2026-03-21T20:45:00.000Z",
  "startedAt": "2026-03-21T20:45:01.000Z",
  "completedAt": "2026-03-21T20:45:12.000Z",
  "sourceKind": "voice",
  "notePath": "notes/atlas-launch-risks.md",
  "taskPaths": ["tasks/book-time-with-sam-next-week.md"],
  "transcriptPath": "_system/transcripts/2026-03-21/cap_1742585560000.md",
  "audioPath": "_system/audio/2026-03-21/cap_1742585560000.m4a"
}
```

## Recommended iPhone UX

- Add the Shortcut to your Home Screen.
- Add it to the Action Button if your iPhone supports one.
- Turn on `Show in Share Sheet` only if you also want to send existing audio files through the same pipeline.
- Once the flow is stable, remove `Quick Look` so the Action Button acts like a silent fire-and-forget capture.
- The production mental model should be: one button to start capture, no waiting for transcription on-screen, iMessage confirms receipt and completion.

## Bind It To The Action Button

On iPhone:

1. Open `Settings`.
2. Open `Action Button`.
3. Swipe until you reach `Shortcut`.
4. Choose the Shortcut you created above.

After that, a single press-and-hold of the Action Button will start the voice capture flow.

## Recording UX Notes

- If the `Record Audio` action on your iPhone supports a non-interactive stop mode such as pause-based or time-based stopping, prefer that over `On Tap`.
- If your iPhone build only exposes `On Tap`, keep the recording step short for now and rely on the asynchronous queue to avoid HTTP timeouts after the upload begins.
- The queue change fixes the network timeout/processing delay problem. It does not change the native recording UI behavior of the Shortcuts `Record Audio` action itself.

## Security

- Keep `CAPTURE_API_TOKEN` enabled if the endpoint is reachable beyond your laptop.
- Prefer HTTPS for any network beyond localhost or trusted LAN.
- If you expose the server publicly, put it behind a private network layer or reverse proxy with auth.

## Quick Smoke Test Without iPhone

You can test the same raw-audio flow locally:

```bash
curl -X POST http://localhost:8787/api/captures/voice \
  -H "Authorization: Bearer change-me" \
  -F "audio=@/absolute/path/to/memo.m4a" \
  -F "device=CLI curl" \
  -F "capturedAt=2026-03-21T18:30:00Z"
```

Text fallback test:

```bash
curl -X POST http://localhost:8787/api/captures/text \
  -H "Authorization: Bearer change-me" \
  -F "text=Remember to follow up with Sam tomorrow about the Atlas launch." \
  -F "device=CLI curl" \
  -F "capturedAt=2026-03-21T18:30:00Z"
```
