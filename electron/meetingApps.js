import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Top 20 meeting applications with their Windows process names.
 */
const MEETING_APPS = [
  { name: 'Zoom', processes: ['Zoom.exe', 'Zoom'] },
  { name: 'Microsoft Teams', processes: ['Teams.exe', 'ms-teams.exe', 'msteams.exe'] },
  { name: 'Google Meet', processes: ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe'] },
  { name: 'Cisco Webex', processes: ['CiscoCollabHost.exe', 'webexmta.exe', 'atmgr.exe', 'webex.exe'] },
  { name: 'Skype', processes: ['Skype.exe', 'SkypeApp.exe'] },
  { name: 'Discord', processes: ['Discord.exe', 'Update.exe'] },
  { name: 'Slack', processes: ['slack.exe'] },
  { name: 'GoTo Meeting', processes: ['g2mcomm.exe', 'g2mlauncher.exe'] },
  { name: 'BlueJeans', processes: ['BlueJeans.exe'] },
  { name: 'RingCentral', processes: ['RingCentral.exe', 'Glip.exe'] },
  { name: 'Whereby', processes: ['chrome.exe', 'msedge.exe'] },
  { name: 'Zoho Meeting', processes: ['ZohoMeeting.exe'] },
  { name: 'Dialpad', processes: ['Dialpad.exe'] },
  { name: 'Lifesize', processes: ['Lifesize.exe'] },
  { name: 'Jitsi Meet', processes: ['chrome.exe', 'msedge.exe', 'firefox.exe'] },
  { name: 'Amazon Chime', processes: ['AmazonChime.exe'] },
  { name: 'Loom', processes: ['Loom.exe'] },
  { name: 'Around', processes: ['Around.exe'] },
  { name: 'Livestorm', processes: ['chrome.exe', 'msedge.exe'] },
  { name: 'Riverside.fm', processes: ['chrome.exe', 'msedge.exe'] },
];

/**
 * Detect running meeting applications by checking active processes on Windows.
 * Returns an array of matched app names.
 */
export async function detectMeetingApps() {
  try {
    // Get running process list on Windows
    const { stdout } = await execAsync(
      'powershell -Command "Get-Process | Select-Object -Property ProcessName -Unique | ForEach-Object { $_.ProcessName }"',
      { timeout: 5000 }
    );

    const runningProcesses = stdout
      .split('\n')
      .map(p => p.trim().toLowerCase())
      .filter(Boolean);

    const detected = [];
    const browserProcesses = ['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe'];

    for (const app of MEETING_APPS) {
      // Skip browser-only apps (Meet, Jitsi, etc.) — they share browser processes
      // and we can't distinguish them without window title checks
      const isWebOnly = app.processes.every(p => browserProcesses.includes(p));
      if (isWebOnly) continue;

      for (const proc of app.processes) {
        const procName = proc.replace('.exe', '').toLowerCase();
        if (runningProcesses.includes(procName)) {
          detected.push(app.name);
          break;
        }
      }
    }

    // Also check browser window titles for web-based meeting apps
    try {
      const { stdout: titleOutput } = await execAsync(
        'powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne \'\'} | Select-Object ProcessName, MainWindowTitle | Format-Table -AutoSize -Wrap"',
        { timeout: 5000 }
      );
      const titleLower = titleOutput.toLowerCase();
      const webIndicators = [
        { keyword: 'meet.google.com', name: 'Google Meet' },
        { keyword: 'google meet', name: 'Google Meet' },
        { keyword: 'zoom meeting', name: 'Zoom' },
        { keyword: 'jitsi', name: 'Jitsi Meet' },
        { keyword: 'whereby', name: 'Whereby' },
        { keyword: 'livestorm', name: 'Livestorm' },
        { keyword: 'riverside', name: 'Riverside.fm' },
      ];
      for (const ind of webIndicators) {
        if (titleLower.includes(ind.keyword) && !detected.includes(ind.name)) {
          detected.push(ind.name);
        }
      }
    } catch {
      // Window title check is best-effort
    }

    return detected;
  } catch (err) {
    console.error('Error detecting meeting apps:', err);
    return [];
  }
}

export { MEETING_APPS };
