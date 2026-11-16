import { useMemo } from 'react';
import type { ClientRecord, ProjectRecord } from '../types/meeting';

import type { MeetingContextValue } from './meetingContext';

interface ContextPickerProps {
  value: MeetingContextValue;
  onChange: (value: MeetingContextValue) => void;
  clients: ClientRecord[];
  projects: ProjectRecord[];
  compact?: boolean;
}

/** Client, project and agenda for a meeting. Everything is optional. */
export default function ContextPicker({ value, onChange, clients, projects, compact = false }: ContextPickerProps) {
  const visibleProjects = useMemo(
    () => (value.clientId ? projects.filter((project) => !project.client_id || project.client_id === value.clientId) : projects),
    [projects, value.clientId],
  );

  const selectProject = (projectId: number | null) => {
    const project = projects.find((item) => item.id === projectId);
    // Picking a project fills in its client.
    onChange({ ...value, projectId, clientId: project?.client_id ?? value.clientId });
  };

  return (
    <div className={`context-picker ${compact ? 'context-picker-compact' : ''}`}>
      <div className="context-picker-row">
        <label className="context-field">
          <span>Client</span>
          <select
            className="setting-input"
            value={value.clientId ?? ''}
            onChange={(e) => {
              const clientId = e.target.value ? Number(e.target.value) : null;
              const project = projects.find((item) => item.id === value.projectId);
              const keepProject = project && (!clientId || !project.client_id || project.client_id === clientId);
              onChange({ ...value, clientId, projectId: keepProject ? value.projectId : null });
            }}
          >
            <option value="">No client</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </label>
        <label className="context-field">
          <span>Project</span>
          <select
            className="setting-input"
            value={value.projectId ?? ''}
            onChange={(e) => selectProject(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">No project</option>
            {visibleProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}{project.client_name && !value.clientId ? ` (${project.client_name})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="context-field">
        <span>What is this meeting about? <em>(optional)</em></span>
        <textarea
          className="setting-input"
          rows={compact ? 2 : 3}
          value={value.agenda}
          onChange={(e) => onChange({ ...value, agenda: e.target.value })}
          placeholder="e.g. Quarterly portfolio review, discuss SIP top-up and insurance renewal"
        />
      </label>
      {clients.length === 0 && projects.length === 0 && (
        <p className="context-hint">Add clients and projects in the Clients tab so their notes and documents are used automatically.</p>
      )}
    </div>
  );
}
