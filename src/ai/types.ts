/** What an import reads into: planned sessions (bookings, schedules) or a usual meal (a recipe). */
export type ImportMode = 'sessions' | 'meal' | 'routine'

/** Content handed to the importer: a picked file, a shared screenshot, or pasted text. */
export type SharedInput =
  /** strips: a long scrolling screenshot cut into overlapping full-width pieces (JPEG base64), top to bottom */
  | { kind: 'image'; mime: string; base64: string; name?: string; strips?: string[] }
  | { kind: 'pdf'; base64: string; name?: string }
  | { kind: 'text'; text: string; name?: string }
