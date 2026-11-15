/**
 * Durable payload carried by a profile confirmation card (propose_profile).
 *
 * The fields a bot may propose for itself (`cwd` is the working folder its
 * tools run in; "" means its private workspace; `notifications`,
 * `speakReplies` and `voiceNotes` are the alert and voice toggles; `color`
 * one of MAUS_COLOR_NAMES; `replyStyle` one of REPLY_STYLES; `voice` the
 * voice its replies are spoken in, "" for the app's). `before` is the snapshot
 * the user was shown; `expectedRevision` is a hash of the target's whole
 * profile at proposal time so a confirmation fails closed if anything moved.
 */
export const PROFILE_REQUEST_FIELDS = ["name", "title", "description", "soul", "cwd", "notifications", "speakReplies", "color", "replyStyle", "voice", "voiceNotes"] as const;
export type ProfileRequestField = (typeof PROFILE_REQUEST_FIELDS)[number];
export const PROFILE_REQUEST_TOGGLES = ["notifications", "speakReplies", "voiceNotes"] as const;
export type ProfileRequestToggle = (typeof PROFILE_REQUEST_TOGGLES)[number];
export const isProfileRequestToggle = (field: ProfileRequestField): field is ProfileRequestToggle =>
  (PROFILE_REQUEST_TOGGLES as readonly string[]).includes(field);
export type ProfileRequestChanges = Partial<Record<Exclude<ProfileRequestField, ProfileRequestToggle>, string>> &
  Partial<Record<ProfileRequestToggle, boolean>>;

export interface ProfileRequestCardData {
  version: 1;
  requestId: string;
  /** The proposing conversation; authority is fixed here. */
  botId: string;
  threadId: string;
  /** Whose profile changes: the proposer, or a section peer named by a Chief. */
  targetBotId: string;
  targetName: string;
  createdAt: number;
  reason: string;
  changes: ProfileRequestChanges;
  before: ProfileRequestChanges;
  expectedRevision: string;
  appliedAt?: number;
  /** Written when the change applied without a person: the profile's
   * revision right after it, so Undo refuses once anything moved. Absent
   * when the before values could not be kept exactly (credential-shaped
   * text is scrubbed from cards), which means no Undo. */
  undo?: { appliedRevision: string };
}
