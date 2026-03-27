import path from 'path';
import fs from 'fs/promises';
import { BrowserWindow } from 'electron';
import { ensureMinutesOfMeeting } from '../ai/minutesOfMeeting.js';
import { readArtifactsFile } from '../ai/artifactStore.js';
import { normalizeText, normalizeTranscriptEntries } from '../text/normalize.js';

export async function exportMeetingMom({
  meeting,
  transcriptEntries,
  format,
}) {
  const normalizedTranscriptEntries = normalizeTranscriptEntries(transcriptEntries);
  const session = {
    title: normalizeText(meeting.title),
    startTime: meeting.start_time_ms,
    endTime: meeting.end_time_ms,
    transcriptEntries: normalizedTranscriptEntries,
    artifactsPath: meeting.artifacts_path,
  };

  let minutes;
  try {
    minutes = await ensureMinutesOfMeeting(session);
  } catch (error) {
    const artifacts = await readArtifactsFile(meeting.artifacts_path);
    const fallbackContent = buildExportFallbackContent(meeting, artifacts?.highlights);
    if (!fallbackContent) {
      throw error;
    }
    minutes = {
      status: 'ready',
      updatedAt: new Date().toISOString(),
      error: null,
      content: fallbackContent,
    };
  }

  if (!minutes?.content) {
    throw new Error('Minutes of Meeting content is not available');
  }

  const outputDir = path.dirname(meeting.artifacts_path || meeting.transcript_path || meeting.video_file_path || '');
  const safeBase = buildSafeBaseName(meeting.title || 'Meeting');

  if (!outputDir) {
    throw new Error('Unable to determine export directory');
  }

  if (format === 'markdown') {
    const markdown = renderMomMarkdown({ meeting, transcriptEntries: normalizedTranscriptEntries, content: minutes.content });
    const filePath = path.join(outputDir, `${safeBase}-MoM.md`);
    await fs.writeFile(filePath, markdown, 'utf8');
    return { filePath, format };
  }

  if (format === 'pdf') {
    const html = renderMomHtml({ meeting, transcriptEntries: normalizedTranscriptEntries, content: minutes.content });
    const filePath = path.join(outputDir, `${safeBase}-MoM.pdf`);
    await writePdfFromHtml(html, filePath);
    return { filePath, format };
  }

  throw new Error(`Unsupported export format: ${format}`);
}

function buildExportFallbackContent(meeting, highlights) {
  if (!highlights?.summary) {
    return null;
  }

  const keyDiscussionPoints = (highlights.keyDiscussionPoints ?? []).map(normalizeText).filter(Boolean);
  const actionItems = (highlights.actionItems ?? []).map(normalizeText).filter(Boolean);

  return {
    title: normalizeText(meeting.title) || 'Untitled Meeting',
    overview: normalizeText(highlights.summary),
    discussionPoints: keyDiscussionPoints.slice(0, 6),
    decisions: keyDiscussionPoints
      .filter((point) => /\b(decided|decision|finalize|finalized|approved|proceed|selected)\b/i.test(point))
      .slice(0, 6),
    actionItems: actionItems.slice(0, 8).map((task) => ({
      task,
      owner: 'Unassigned',
      deadline: 'Not specified',
      status: 'Open',
      notes: '',
    })),
    risksAndBlockers: keyDiscussionPoints
      .filter((point) => /\b(concern|risk|blocker|difficult|cost|issue|delay|complex)\b/i.test(point))
      .slice(0, 4),
    followUps: actionItems.slice(0, 4).map((item) => `Follow up on: ${item}`),
  };
}

function renderMomMarkdown({ meeting, transcriptEntries, content }) {
  const lines = [];
  lines.push(`# ${content.title}`);
  lines.push('');
  lines.push(`- Date: ${formatMeetingDate(meeting.date)}`);
  lines.push(`- Duration: ${formatDuration(meeting.start_time_ms, meeting.end_time_ms)}`);
  lines.push(`- Speakers: ${countSpeakers(transcriptEntries)}`);
  lines.push(`- Transcript Lines: ${transcriptEntries.length}`);
  lines.push('');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(content.overview);
  lines.push('');
  appendBulletSection(lines, 'Discussion Points', content.discussionPoints);
  appendBulletSection(lines, 'Decisions', content.decisions);
  lines.push('## Action Items');
  lines.push('');

  if (content.actionItems.length === 0) {
    lines.push('- No explicit action items were captured.');
  } else {
    lines.push('| Task | Owner | Deadline | Status | Notes |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const item of content.actionItems) {
      lines.push(`| ${escapeMarkdownTable(item.task)} | ${escapeMarkdownTable(item.owner)} | ${escapeMarkdownTable(item.deadline)} | ${escapeMarkdownTable(item.status)} | ${escapeMarkdownTable(item.notes || '-')} |`);
    }
  }

  lines.push('');
  appendBulletSection(lines, 'Risks and Blockers', content.risksAndBlockers);
  appendBulletSection(lines, 'Follow-Ups', content.followUps);
  return lines.join('\n').trimEnd();
}

function renderMomHtml({ meeting, transcriptEntries, content }) {
  const bulletsToHtml = (items) => items.length === 0
    ? '<p class="empty">None recorded.</p>'
    : `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;

  const actionRows = content.actionItems.length === 0
    ? '<tr><td colspan="5" class="empty-cell">No explicit action items were captured.</td></tr>'
    : content.actionItems.map((item) => `
      <tr>
        <td>${escapeHtml(item.task)}</td>
        <td>${escapeHtml(item.owner)}</td>
        <td>${escapeHtml(item.deadline)}</td>
        <td>${escapeHtml(item.status)}</td>
        <td>${escapeHtml(item.notes || '-')}</td>
      </tr>
    `).join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(content.title)}</title>
    <style>
      body { font-family: "Segoe UI", Arial, sans-serif; margin: 38px 42px; color: #1f2937; }
      h1 { font-size: 28px; margin: 0 0 6px; color: #111827; }
      h2 { font-size: 16px; margin: 24px 0 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; }
      p { font-size: 12px; line-height: 1.7; margin: 0 0 10px; }
      ul { margin: 0; padding-left: 18px; }
      li { font-size: 12px; line-height: 1.6; margin-bottom: 6px; }
      .meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0 24px; }
      .meta-card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; background: #f9fafb; }
      .meta-label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 4px; }
      .meta-value { display: block; font-size: 14px; font-weight: 700; color: #111827; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th, td { border: 1px solid #e5e7eb; padding: 10px 12px; text-align: left; vertical-align: top; font-size: 11px; }
      th { background: #f3f4f6; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #4b5563; }
      .section { page-break-inside: avoid; }
      .empty, .empty-cell { color: #6b7280; font-style: italic; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(content.title)}</h1>
    <p>Prepared by AgentZero as a Minutes of Meeting summary.</p>

    <div class="meta">
      <div class="meta-card"><span class="meta-label">Date</span><span class="meta-value">${escapeHtml(formatMeetingDate(meeting.date))}</span></div>
      <div class="meta-card"><span class="meta-label">Duration</span><span class="meta-value">${escapeHtml(formatDuration(meeting.start_time_ms, meeting.end_time_ms))}</span></div>
      <div class="meta-card"><span class="meta-label">Speakers</span><span class="meta-value">${escapeHtml(String(countSpeakers(transcriptEntries)))}</span></div>
      <div class="meta-card"><span class="meta-label">Transcript Lines</span><span class="meta-value">${escapeHtml(String(transcriptEntries.length))}</span></div>
    </div>

    <div class="section">
      <h2>Executive Summary</h2>
      ${content.overview.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
    </div>

    <div class="section">
      <h2>Discussion Points</h2>
      ${bulletsToHtml(content.discussionPoints)}
    </div>

    <div class="section">
      <h2>Decisions</h2>
      ${bulletsToHtml(content.decisions)}
    </div>

    <div class="section">
      <h2>Action Items</h2>
      <table>
        <thead>
          <tr>
            <th>Task</th>
            <th>Owner</th>
            <th>Deadline</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>${actionRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Risks and Blockers</h2>
      ${bulletsToHtml(content.risksAndBlockers)}
    </div>

    <div class="section">
      <h2>Follow-Ups</h2>
      ${bulletsToHtml(content.followUps)}
    </div>
  </body>
</html>`;
}

async function writePdfFromHtml(html, outputPath) {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: false,
    },
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdfBuffer = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: {
        top: 0.4,
        bottom: 0.4,
        left: 0.35,
        right: 0.35,
      },
    });
    await fs.writeFile(outputPath, pdfBuffer);
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

function appendBulletSection(lines, heading, items) {
  lines.push(`## ${heading}`);
  lines.push('');
  if (items.length === 0) {
    lines.push('- None recorded.');
  } else {
    items.forEach((item) => lines.push(`- ${item}`));
  }
  lines.push('');
}

function formatMeetingDate(dateValue) {
  if (!dateValue) return 'Unknown';
  return new Date(dateValue).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(startTime, endTime) {
  if (!startTime || !endTime) return 'Unknown';
  const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000));
  return `${durationMinutes} min`;
}

function countSpeakers(transcriptEntries) {
  return new Set(
    transcriptEntries
      .filter((entry) => entry.speakerLabel !== 'You')
      .map((entry) => entry.speakerLabel),
  ).size;
}

function buildSafeBaseName(title) {
  return String(title || 'Meeting')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    || 'Meeting';
}

function escapeMarkdownTable(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, '<br />');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
