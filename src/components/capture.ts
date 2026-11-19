/** What a meeting records. Mic and computer sound can be switched during the meeting. */
export interface CaptureChoice {
  /** Your voice. */
  microphone: boolean;
  /** The other people on a call: everything the computer plays. */
  computerSound: boolean;
  /** A video of the screen (or the meeting app's window). Fixed once recording starts. */
  screenVideo: boolean;
}

export interface CaptureState extends CaptureChoice {
  /** Set when a source was asked for but could not be captured. */
  problem: string | null;
  /** What the screen video shows ('auto' = meeting window). */
  videoSource?: string;
}

export interface CaptureControls {
  setMicrophone: (on: boolean) => Promise<void>;
  setComputerSound: (on: boolean) => Promise<void>;
  /** Switch what the screen video shows ('auto' = meeting window). */
  setVideoSource: (sourceId: string) => Promise<void>;
  /** Meeting apps found at start; the video picker is offered only when there is one. */
  detectedApps: string[];
}

/** Mic / computer-sound loudness (0..1 RMS), published ~10x per second while recording. */
export interface CaptureLevels { mic: number; system: number }

type LevelListener = (levels: CaptureLevels) => void;
const levelListeners = new Set<LevelListener>();

export const levelBus = {
  publish(levels: CaptureLevels) {
    levelListeners.forEach((listener) => listener(levels));
  },
  subscribe(listener: LevelListener) {
    levelListeners.add(listener);
    return () => { levelListeners.delete(listener); };
  },
};
