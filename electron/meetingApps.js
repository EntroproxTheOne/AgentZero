import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Desktop meeting apps — exact Windows process names.
 */
const DESKTOP_APPS = [
  { name: 'Zoom', processes: ['Zoom.exe'] },
  { name: 'Microsoft Teams', processes: ['ms-teams.exe', 'ms-teams_modulehost.exe', 'Teams.exe'] },
  { name: 'Cisco Webex', processes: ['CiscoCollabHost.exe', 'atmgr.exe', 'CiscoWebExStart.exe'] },
  { name: 'Skype', processes: ['Skype.exe'] },
  { name: 'Discord', processes: ['Discord.exe'] },
  { name: 'Slack', processes: ['slack.exe'] },
  { name: 'GoToMeeting', processes: ['g2mcomm.exe', 'GoToMeeting.exe'] },
  { name: 'BlueJeans', processes: ['BlueJeans.exe'] },
];

/**
 * Browser processes to check for web-based meetings.
 */
const BROWSER_PROCESSES = ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe'];

/**
 * Window title keywords for browser-based meetings.
 */
const BROWSER_TITLE_KEYWORDS = [
  { keyword: 'Meet -', name: 'Google Meet' },
  { keyword: 'meet.google.com', name: 'Google Meet' },
  { keyword: 'Zoom Meeting', name: 'Zoom' },
  { keyword: 'Microsoft Teams', name: 'Microsoft Teams' },
  { keyword: 'Webex', name: 'Webex' },
];

// macOS: app process names, plus window titles (browser meetings, e.g. "Meet - abc-defg-hij"
// in Safari or Chrome). Window titles need Screen Recording permission; without it
// only the native apps are found.
const MAC_APPS = [
  { name: 'Zoom', match: /(^|\/)zoom\.us$/i },
  { name: 'Microsoft Teams', match: /(^|\/)(MSTeams|Microsoft Teams( \(work or school\))?)$/i },
  { name: 'Cisco Webex', match: /(^|\/)(Webex|Cisco Webex Meetings)$/i },
  { name: 'Slack', match: /(^|\/)Slack$/i },
  { name: 'FaceTime', match: /(^|\/)FaceTime$/i },
  { name: 'Discord', match: /(^|\/)Discord$/i },
  { name: 'Skype', match: /(^|\/)Skype$/i },
];

async function detectMacMeetingApps() {
  const detected = [];
  try {
    const { stdout } = await execAsync('ps -axo comm=', { maxBuffer: 4 * 1024 * 1024 });
    const names = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const app of MAC_APPS) {
      if (names.some((name) => app.match.test(name))) detected.push(app.name);
    }
  } catch (error) {
    console.warn('[MeetingApps] ps failed:', error.message);
  }
  try {
    const { desktopCapturer } = await import('electron');
    const windows = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
    for (const win of windows) {
      for (const kw of BROWSER_TITLE_KEYWORDS) {
        if (win.name.includes(kw.keyword) && !detected.some((name) => name.startsWith(kw.name))) {
          detected.push(`${kw.name} (browser)`);
        }
      }
    }
  } catch {
    // No Screen Recording permission yet: native apps only.
  }
  return detected;
}

/**
 * Detect running meeting applications.
 * Returns array of detected app names (e.g. ['Zoom'], ['Google Meet (Chrome)'], or []).
 */
export async function detectMeetingApps() {
  if (process.platform === 'darwin') return detectMacMeetingApps();

  const detected = [];

  try {
    // Get list of running processes
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "Get-Process | Select-Object -Property ProcessName | ConvertTo-Json"',
      { maxBuffer: 1024 * 1024 }
    );

    let processes = [];
    try {
      const parsed = JSON.parse(stdout);
      processes = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }

    const runningProcesses = new Set(
      processes.map(p => (p.ProcessName || '').toLowerCase())
    );

    // 1. Check desktop apps
    for (const app of DESKTOP_APPS) {
      const found = app.processes.some(proc =>
        runningProcesses.has(proc.replace('.exe', '').toLowerCase())
      );
      if (found) {
        detected.push(app.name);
      }
    }

    // 2. Check browser-based meetings via window titles
    const hasBrowser = BROWSER_PROCESSES.some(proc =>
      runningProcesses.has(proc.replace('.exe', '').toLowerCase())
    );

    if (hasBrowser) {
      try {
        // Get window titles from all browser processes
        const { stdout: titleOut } = await execAsync(
          'powershell -NoProfile -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne \'\'} | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json"',
          { maxBuffer: 1024 * 1024 }
        );

        let windows = [];
        try {
          const parsedW = JSON.parse(titleOut);
          windows = Array.isArray(parsedW) ? parsedW : [parsedW];
        } catch {
          windows = [];
        }

        // Filter to browser windows only
        const browserWindows = windows.filter(w => {
          const pname = (w.ProcessName || '').toLowerCase();
          return BROWSER_PROCESSES.some(bp => bp.replace('.exe', '').toLowerCase() === pname);
        });

        // Check window titles for meeting keywords
        for (const win of browserWindows) {
          const title = win.MainWindowTitle || '';
          const pname = (win.ProcessName || '').toLowerCase();

          for (const kw of BROWSER_TITLE_KEYWORDS) {
            if (title.includes(kw.keyword)) {
              // Determine browser name for display
              let browserName = 'Browser';
              if (pname.includes('chrome')) browserName = 'Chrome';
              else if (pname.includes('msedge')) browserName = 'Edge';
              else if (pname.includes('firefox')) browserName = 'Firefox';
              else if (pname.includes('brave')) browserName = 'Brave';

              const label = `${kw.name} (${browserName})`;
              if (!detected.includes(label) && !detected.includes(kw.name)) {
                detected.push(label);
              }
              break;
            }
          }
        }
      } catch {
        // Window title check failed — skip
      }
    }
  } catch (err) {
    console.error('Meeting detection error:', err);
  }

  return detected;
}
