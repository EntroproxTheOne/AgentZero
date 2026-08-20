# Hpair Meeting Capture and AI Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Windows-runnable AgentZero build on `hpair` with access enforcement disabled, opt-in screen video, microphone-only Nova-3 transcription, and resilient Gemini routing.

**Architecture:** The main process owns access enforcement, persisted settings, and the per-meeting screen-capture snapshot. The renderer creates either a video recorder plus microphone stream or a microphone-only session. The PCM worklet emits mono audio, and AI requests use named Gemini fallback chains with optional Search grounding.

**Tech Stack:** Electron, React, TypeScript, SQLite (`better-sqlite3`), Deepgram SDK v5, Sarvam WebSocket adapter, `@google/genai`, Electron Builder.

**Spec:** `docs/superpowers/specs/2026-08-21-hpair-meeting-capture-and-ai-routing-design.md`

## Global Constraints

- Work only on the existing `hpair` branch; do not create a worktree.
- Screen recording defaults to off and applies to the next meeting.
- Device/loopback audio must not be requested or sent to transcription.
- Deepgram Nova-3 is the default speech provider; Sarvam remains explicit optional Native India Mode.
- Gemini fast chain is `gemini-3.5-flash-lite` then `gemini-3.1-flash-lite`.
- Gemini big chain is `gemini-3.7-flash`, then `gemini-3.6-flash`, then `gemini-3.5-flash`.
- Never print or commit API key values.

---

### Task 1: Access and persisted capture settings

**Files:**
- Modify: `electron/runtimeConfig.js`
- Modify: `electron/db.js`
- Modify: `src/types/meeting.ts`
- Modify: `src/types/global.d.ts`
- Modify: `src/components/SettingsPage.tsx`

**Interfaces:**
- `getAppAccessSnapshot()` returns `allowed: true` when enforcement is disabled.
- `getAppSettings()` returns `screenRecordingEnabled: boolean`.
- `updateAppSettings({ nativeIndiaMode?, screenRecordingEnabled? })` preserves omitted settings.

- [x] Add the `screen_recording_enabled` SQLite column/migration with default `0`, expose the boolean, and update partial settings writes.
- [x] Add the typed setting and a Settings toggle that saves independently from Native India Mode.
- [x] Set access enforcement off and make the disabled state an allow state.
- [x] Run `node --check` on changed Electron files and inspect `git diff` for secret values.

### Task 2: Audio-only and video-enabled meeting lifecycle

**Files:**
- Modify: `electron/main.js`
- Modify: `src/types/meeting.ts`
- Modify: `src/components/MeetingRecorder.tsx`
- Modify: `src/components/PastMeetings.tsx`
- Modify: `electron/preload.cjs` only if the existing bridge needs a typed/runtime change

**Interfaces:**
- `start-meeting` returns `recordScreen` and stores it in the meeting session.
- Audio-only sessions have no video writer and stop without FFmpeg remux.
- `MeetingRecorder` starts/stops correctly with `mediaRecorderRef.current === null`.

- [x] Snapshot `screenRecordingEnabled` in the main-process session and skip video-path/writer creation when false.
- [x] Guard video chunk and flush handlers for audio-only sessions; preserve transcript/artifact paths.
- [x] Make stop logic conditional on video recording and keep folder navigation working from the transcript path.
- [x] Request display video without audio and bypass display capture entirely when the setting is off.
- [x] Run TypeScript checking after the renderer changes.

### Task 3: Microphone-only PCM and Nova-3 diarization

**Files:**
- Modify: `public/pcm-processor.js`
- Modify: `src/components/MeetingRecorder.tsx`
- Modify: `electron/transcription/providers/deepgramProvider.js`
- Modify: `electron/transcription/providers/sarvamProvider.js`

**Interfaces:**
- The worklet posts `{ type: 'audio-chunk', buffer: ArrayBuffer }` containing mono signed 16-bit PCM.
- Deepgram opens Nova-3 with one channel, `diarize_model: 'latest'`, and no device-audio channel.
- Sarvam accepts mono PCM without stereo downmixing.

- [x] Reduce the worklet to one microphone input and emit one PCM sample per input sample.
- [x] Start the PCM pipeline from the microphone only in both screen modes.
- [x] Update Deepgram v5 boolean query values to strings and preserve final/interim transcript handling.
- [x] Remove the Sarvam stereo downmix assumption so Native India Mode remains functional.
- [x] Run syntax checks and inspect the provider configuration with `rg`.

### Task 4: Gemini model chains and optional Search grounding

**Files:**
- Modify: `electron/ai/config.js`
- Modify: `electron/ai/providers/gemini.js`
- Modify: `electron/ai/quickLook.js`
- Modify: `electron/ai/highlights.js`
- Modify: `electron/ai/minutesOfMeeting.js`
- Modify: `electron/ai/liveInsights.js`
- Modify: `electron/main.js`

**Interfaces:**
- `generateGeminiJson({ tier, prompt, maxOutputTokens, useSearch })` attempts the configured chain and returns the actual `model` used.
- Fast and big callers select the correct tier; QuickLook can request Search for current/external questions.

- [x] Define fast/big chains and remove Gemini 3.x `temperature`/`topP` request fields.
- [x] Add model fallback attempts with aggregated errors and a no-Search retry path.
- [x] Route live insights/auto-title/simple QuickLook to fast and summaries/complex QuickLook to big.
- [x] Record the actual fallback model in debug artifacts.
- [x] Run syntax checks and verify all old Gemini model constants are gone from active call sites.

### Task 5: Dependency cleanup, verification, and Windows build

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] Replace direct `electron-rebuild` with maintained `@electron/rebuild` without changing unrelated dependencies.
- [x] Install exact lockfile dependencies with `npm ci`.
- [x] Run `npm run lint` and `npx tsc -b`.
- [x] Run `npm run build:win` and verify a portable `.exe` exists under `release/`.
- [x] Run final runtime/access, syntax, status, and secret-scan checks; report any build limitation honestly.
