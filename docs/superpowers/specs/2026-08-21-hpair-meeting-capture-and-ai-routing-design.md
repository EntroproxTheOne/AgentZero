# Hpair Meeting Capture and AI Routing Design

**Status:** Approved by Manav for implementation on branch `hpair`.

## Goal

Make AgentZero usable without the test-build access lock, make screen recording an opt-in Settings preference, keep microphone transcription and meeting intelligence working without capturing device audio, and add resilient Gemini model routing for fast and complex tasks.

## Scope

- Disable runtime access enforcement while preserving the existing access status API for diagnostics.
- Add a persisted screen-recording preference, defaulting to off.
- Keep microphone capture and transcription active when screen recording is off.
- Never feed system/device/loopback audio into the transcription stream.
- Use Deepgram Nova-3 as the default speech provider with microphone-only PCM.
- Keep Sarvam Native India Mode as an explicit optional provider.
- Route Gemini requests through fast and big model fallback chains.
- Use Google Search grounding for current/external QuickLook questions when available, with a no-search retry path.
- Replace the directly deprecated `electron-rebuild` development dependency with `@electron/rebuild`.
- Produce and verify the existing Windows portable target.

## Architecture

The main process remains authoritative for runtime access and persisted capture settings. At meeting start it snapshots the screen preference into the meeting session, so changing Settings during a meeting cannot partially change that meeting. The renderer uses the returned snapshot to decide whether to create a video recorder, while the main process refuses video chunks for audio-only sessions and avoids creating a video file.

Audio is deliberately independent from display capture. The renderer obtains only a microphone stream and sends mono 16 kHz PCM through the AudioWorklet. Deepgram receives one channel with Nova-3 diarization enabled; device audio is not requested from Electron’s display-media handler and is not mixed into PCM. Because a single microphone signal cannot identify the owner of a voice, diarized transcript entries are labeled by speaker number rather than asserting that speaker zero is the user.

Gemini calls use ordered model chains. Fast tasks use `gemini-3.5-flash-lite` then `gemini-3.1-flash-lite`. Big tasks use `gemini-3.7-flash`, then `gemini-3.6-flash`, then `gemini-3.5-flash`. A failed provider request advances to the next model; a search-grounded request also retries without Search if the Search tool is unavailable. Gemini 3.x requests omit deprecated sampling parameters.

## Components and data flow

### Runtime access

`electron/runtimeConfig.js` changes the access configuration to non-enforcing mode. A disabled gate returns an active, allowed snapshot on every platform. Existing guarded IPC and periodic checks remain intact so future enforcement can be re-enabled without rewiring the application.

### Settings and persistence

`AppSettings` gains `screen_recording_enabled INTEGER NOT NULL DEFAULT 0`. Existing databases receive the column through the current migration pattern. `getAppSettings()` returns `screenRecordingEnabled`; `updateAppSettings()` accepts partial updates for the India-mode and screen-recording flags without overwriting the other value.

The Settings page exposes a Screen Recording toggle with copy that makes the effect explicit. The default is off, and the setting applies to the next meeting. Native India Mode remains an independent optional toggle.

### Meeting lifecycle

At `start-meeting`, the main process reads the current screen preference and stores `recordScreen` in the in-memory session. Audio-only sessions create the meeting folder, transcript, and artifact paths but no temporary video path or video writer. Video sessions keep the existing WebM writer and FFmpeg remux path.

At stop, audio-only sessions finalize transcription and AI artifacts without remuxing or writing a video file. The meeting folder remains available through its transcript path.

### Capture and transcription

When `recordScreen` is false, the renderer creates no display stream and no `MediaRecorder`; it captures the microphone and runs the PCM pipeline. When true, it requests video-only display capture and records the display plus microphone as a WebM. The Electron display handler returns video without loopback audio, and the renderer never requests a display audio track.

The PCM processor emits mono signed 16-bit samples. Deepgram uses the current v5 connection syntax with Nova-3, `language=multi`, one channel, string boolean query values, and `diarize_model=latest`. The Sarvam adapter accepts the same mono PCM without stereo downmixing.

### AI routing

The AI configuration defines named fast and big model chains. Live insights, auto-title, and simple QuickLook use the fast chain. Meeting highlights, Minutes of Meeting, and complex QuickLook use the big chain. QuickLook detects an external/current-information intent and requests Google Search grounding; if the search-enabled call cannot be completed, the provider retries without Search.

Provider responses expose the model actually used so artifact debug records remain accurate when a fallback model answers.

## Error handling

- Missing API keys retain the existing provider-specific errors.
- Gemini fallback errors are aggregated into one final error after all candidates are attempted.
- Search-tool failures do not block QuickLook; the same candidate chain is retried without Search.
- Audio-only meetings do not treat the absence of a video recorder as an error.
- Existing access guard behavior remains fail-closed only when enforcement is later enabled.
- A failed screen permission request reports the existing platform-specific recorder error and does not silently continue as an audio-only meeting.

## Verification and acceptance criteria

- `hpair` is the active branch and the working tree is clean before implementation begins.
- Runtime snapshot reports `allowed: true` with access enforcement disabled, including on macOS code paths.
- Existing databases migrate and return `screenRecordingEnabled: false` by default.
- Settings can toggle screen recording without changing Native India Mode.
- Screen-off meeting starts microphone capture, sends mono PCM, creates no video chunks, and stops successfully.
- Screen-on meeting requests video only, creates video chunks, and still sends microphone-only PCM.
- Deepgram connection uses Nova-3 and one-channel diarization configuration.
- Gemini calls use the requested primary/fallback chains and do not send `temperature` or `topP`.
- Search-enabled QuickLook has a no-search fallback.
- `npm run lint`, `npm run build`, and `npm run build:win` are run after dependencies are installed; the Windows portable executable exists in `release/`.
- No API key values are printed or committed.
