export interface MeetingContextValue {
  clientId: number | null;
  projectId: number | null;
  agenda: string;
}

export const EMPTY_CONTEXT: MeetingContextValue = { clientId: null, projectId: null, agenda: '' };
