# Built-in keys

`provisioned.json` here is packed into the app so a client build needs no setup.
It is written by CI from GitHub secrets and is git-ignored: never commit it.
Anyone holding the installer could read these keys, so share the build only with the client,
restrict the Gemini key to the Vertex AI API and set a budget alert.

```json
{ "gcpProjectId": "...", "geminiApiKey": "...", "sarvamApiKey": "..." }
```

The location is not configurable: AI always runs in asia-south1 (Mumbai).
