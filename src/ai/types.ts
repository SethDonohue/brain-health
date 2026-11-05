/** What an import reads into: planned sessions (bookings, schedules) or a usual meal (a recipe). */
export type ImportMode = 'sessions' | 'meal'

/** Content handed to the importer: a picked file, a shared screenshot, or pasted text. */
export type SharedInput =
  | { kind: 'image'; mime: string; base64: string; name?: string }
  | { kind: 'pdf'; base64: string; name?: string }
  | { kind: 'text'; text: string; name?: string }
