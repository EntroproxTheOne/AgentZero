# Review: AgentZero mac-pilot, Notes/Live meeting assistant (commit b0215c9)

You are reviewing an Electron + React meeting assistant for a wealth adviser in India (pilot client). Branch `mac-pilot`, repo root `AgentZero/`. Review only; do not commit or push. Produce one report.

## What the app does now (read this before the code)
- **Notes mode (default):** records locally. While recording, nothing streams and no AI runs; the UI shows only a timer and mic / call-audio level meters. After Stop: one Sarvam Saaras v4 batch pass with diarization (₹0.59/min), then speaker mapping, then ONE Gemini 3.5 Flash extraction call (Vertex AI, asia-south1 only).
- **Speaker mapping (no API cost):** the renderer measures mic RMS and computer-sound RMS separately every 100 ms (`levels.bin`). Each diarized speaker is placed local (the owner's mic) or remote (the call) by the median per-frame mic share `mic/(mic+system)`, so laptop-speaker bleed is handled. The owner is labelled with the user's name. If the system track is silent all meeting (phone at the ear, in person), the recording is "one-sided": a banner shows and the extraction must not invent the other side. "Is this you?" appears only on low confidence; every answer is logged (`SpeakerFeedback`).
- **One meeting record:** `artifacts.extraction` = summary, key points, decisions (status confirmed/proposed/discussed/unclear/reversed + line evidence), action items (owner + evidence line, due, status), figures, documents requested, open questions. A validator rejects missing or invalid evidence and conflicting decisions, retries once, then quarantines the bad items as "unclear". Highlights, minutes, the PDF/Markdown export, Ask and templates all READ this object. User edits write back to it. Decisions and tasks are mirrored into the `MeetingItems` table (client_id, owner, due, status, source line) for a future CRM sync. There is also a JSON record export.
- **Ask after the meeting:** the record + the full numbered transcript + history, on Flash. Answers cite `[L#]` lines that jump to the transcript. Editable templates (client email, internal checklist, task list, custom) render ONLY from the record. Cross-meeting Ask (`askAll.js`) uses each meeting's record and cites the meeting and line.
- **Live mode (opt-in, "Best for 1:1"):** Sarvam streaming without diarization; each utterance is labelled You / Client from the levels. Quick Ask runs on Flash-Lite. Optional auto-insights every 2/5/10 min, max 20 per meeting; each call sends only new speech plus a ≤300-token summary. "Go live" mid-meeting optionally batch-transcribes the earlier audio (catch-up). After a Live meeting there is no second pass unless the labels were unclear, in which case "Improve speaker labels (≈₹X)" is offered.
- **Video:** optional screen video. The recorded video track is a canvas that copies the current source, so the user can switch between the meeting window, a whole screen or another window mid-meeting. The picker only appears when a meeting app was detected. macOS meeting-app detection uses `ps` plus window titles (Meet in Safari or Chrome).

Key files: `electron/main.js` (IPC, start/stop, go-live, catch-up, post-meeting handlers), `electron/pipeline.js`, `electron/speakers.js`, `electron/ai/extraction.js`, `electron/ai/meetingAsk.js`, `electron/ai/askAll.js`, `electron/ai/liveInsights.js`, `electron/ai/cost.js`, `electron/db.js`, `electron/meetingApps.js`, `electron/transcription/sarvamBatch.js`, `src/components/MeetingRecorder.tsx`, `ConsentModal.tsx`, `CaptureBar.tsx`, `VideoSourcePicker.tsx`, `NotesRecording.tsx`, `PostMeetingDashboard.tsx`, `SettingsPage.tsx`, `TemplatesSettings.tsx`.

## What to review, in this order
1. **Critical bugs (most important).** Anything that loses a recording, produces a wrong record, mislabels the owner, crashes, leaks or never finishes processing. Trace these paths end to end:
   - Notes meeting: start → stop → batch → mapping → extraction → dashboard; and app quit mid-recording → recovery on the next launch.
   - Live meeting; Notes → Go live with and without catch-up (gaps or duplicates in the final transcript? timestamp alignment?); Improve speaker labels.
   - Speaker corrections (`confirm-owner`, `rename-speaker`, `reassign-line`, refresh): do the transcript, speaker map, record and `MeetingItems` stay consistent?
   - Level timestamps vs Sarvam batch timestamps: are they aligned well enough for mapping? What if the levels file is missing (uploads, older meetings)?
   - Video source switching: the canvas compositor with `backgroundThrottling: false`; old-track cleanup; the shared window closing mid-meeting; CPU cost.
   - Extraction validator: can a valid answer be rejected forever? Does quarantine ever drop the correct decision? Is `superseded_by` honoured?
   - Concurrency: `updateArtifactsFile` chains vs direct writes to `transcript.json`; `processMeeting` re-entry; edits arriving while the pipeline runs.
2. **Correctness of cost and data rules.** Notes mode must make zero AI and zero streaming calls during recording, one batch job, and ≤3 AI calls for the record. Check every `generateGeminiJson` call site and purpose tag. Are client data or transcripts ever sent anywhere other than Vertex asia-south1 and Sarvam? (Web search in QuickLook must send only the question.)
3. **UI/UX.** The start sheet (Online / In person, Notes / Live, video picker), the recording screen, the dashboard (banners, speaker chips, decisions/tasks editing, Ask panel, citations, transcript "wrong speaker" selects), Settings. Look for confusing states, dead ends, missing loading or error states, layout breaks at 900 px width, and dark mode.
4. **Improvements: ONLY if necessary.** Suggest something only if it fixes a real problem found above, OR it is a capability that established meeting assistants (Granola, Otter, Fireflies, Fathom, tl;dv, Read.ai, Zoom AI Companion, Microsoft Copilot in Teams) actually ship and this user clearly needs (a wealth adviser, mostly 1:1 client calls, wants post-meeting Ask, templates and client history, and no live distractions). For each suggestion, name the product(s) that do it. No speculative features, refactors for taste, or "nice to have" polish.

## Constraints
- Do not run destructive commands or read secret files (`.env`, `provisioning/provisioned.json`, credential stores). Do not print API keys.
- Never put real client data in tests or examples; use made-up names.
- You may run `npx tsc -b`, `npm run lint` and `npm test`. Live AI calls cost money: avoid them unless a finding needs proof.

## Report format
- **Critical** (must fix before the client uses it): file:line, what breaks, how to reproduce, the suggested fix.
- **Major**: same format.
- **Minor**: one line each.
- **Improvements (only if justified)**: what, why this user needs it, which products already do it, rough size (S/M/L).
- **Verified OK**: the paths you traced that hold up, so they are not re-checked.
Keep it tight: no praise and no restating of the code.
