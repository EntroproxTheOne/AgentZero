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
}

export interface CaptureControls {
  setMicrophone: (on: boolean) => Promise<void>;
  setComputerSound: (on: boolean) => Promise<void>;
}
