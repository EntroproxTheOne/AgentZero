// Credentials live in ./credentials.js (encrypted, editable in Settings).

const ACCESS_CONFIG = Object.freeze({
  // Keep the test-build access gate disabled for the Windows build.
  enabled: false,
  // Update this before sharing a test build.
  expiresAt: '2026-04-05T23:59:59+05:30',
  shutdownMessage: 'This AgentZero test build has expired. Please contact the sender for a fresh copy.',
});

export function getAppAccessSnapshot(now = Date.now()) {
  if (!ACCESS_CONFIG.enabled || process.platform !== 'darwin') {
    return {
      allowed: true,
      reason: 'active',
      expiresAt: ACCESS_CONFIG.expiresAt,
      shutdownMessage: ACCESS_CONFIG.shutdownMessage,
    };
  }

  const expiresAtMs = Date.parse(ACCESS_CONFIG.expiresAt);
  if (Number.isNaN(expiresAtMs)) {
    return {
      allowed: false,
      reason: 'invalid-expiry',
      expiresAt: ACCESS_CONFIG.expiresAt,
      shutdownMessage: 'This AgentZero build has an invalid expiry configuration.',
    };
  }

  if (now > expiresAtMs) {
    return {
      allowed: false,
      reason: 'expired',
      expiresAt: ACCESS_CONFIG.expiresAt,
      shutdownMessage: ACCESS_CONFIG.shutdownMessage,
    };
  }

  return {
    allowed: true,
    reason: 'active',
    expiresAt: ACCESS_CONFIG.expiresAt,
    shutdownMessage: ACCESS_CONFIG.shutdownMessage,
  };
}

export function assertAccessAllowed() {
  const snapshot = getAppAccessSnapshot();
  if (!snapshot.allowed) {
    const error = new Error(snapshot.shutdownMessage);
    error.code = 'APP_ACCESS_BLOCKED';
    error.access = snapshot;
    throw error;
  }
}
