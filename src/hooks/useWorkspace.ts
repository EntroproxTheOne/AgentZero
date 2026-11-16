import { useCallback, useEffect, useState } from 'react';
import type { ClientRecord, ProjectRecord } from '../types/meeting';

/** Clients and projects, reloaded on demand (e.g. after an edit). */
export function useWorkspace(refreshKey = 0) {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void window.electronAPI?.listWorkspace().then((data) => {
      if (!active) return;
      setClients(data.clients);
      setProjects(data.projects);
    }).catch(() => {});
    return () => { active = false; };
  }, [refreshKey, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { clients, projects, reload };
}
