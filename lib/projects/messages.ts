/*
 * Every string of the client projects feature (agency fork): the pages, the
 * forms and the errors the API answers with. In one place so a translation
 * replaces this file only.
 */

const STATUS = { client: "Client", prospect: "Prospect", paused: "Paused", archived: "Archived" } as const;
const ROLE = { owner: "Owner", editor: "Editor", viewer: "Viewer" } as const;
const NOTE_KIND = { brief: "Brief", audience: "Audience", chat: "Client chat", strategy: "Strategy", other: "Other" } as const;
const TASK_STATUS = { todo: "To do", doing: "In progress", review: "Review", done: "Done" } as const;
const PRIORITY = { low: "Low", normal: "Normal", high: "High" } as const;
const FILE_CATEGORY = { materials: "Materials", chat: "Client chat" } as const;

export const PROJECT_MESSAGES = {
  labels: { status: STATUS, role: ROLE, noteKind: NOTE_KIND, taskStatus: TASK_STATUS, priority: PRIORITY, fileCategory: FILE_CATEGORY },

  errors: {
    notFound: "Project not found",
    noteNotFound: "Note not found",
    fileNotFound: "File not found",
    entryNotFound: "Journal entry not found",
    taskNotFound: "Task not found",
    memberNotFound: "Member not found",
    siteNotFound: "Site not found",
    forbidden: (role: string, need: string) => `Your role in this project is ${role}; this needs ${need} or above.`,
    readOnlyKey: "This key is read-only. Create a key with the write scope in Settings > MCP to change projects.",
    slug: "slug must be 2 to 48 of a-z, 0-9 and -, not starting or ending with -",
    slugReserved: "This slug is reserved, pick another one",
    slugTaken: "A project with this slug already exists",
    slugNeeded: "Give the project a slug: the name has no Latin letters or digits to make one from",
    nameEmpty: "Name is empty",
    titleEmpty: "Title is empty",
    textEmpty: "Text is empty",
    noteTooLong: "The note is too long",
    noteTaken: "A note of this kind with this title already exists",
    versionConflict: (current: number) =>
      `The note changed since you loaded it (now version ${current}). Reload it and apply your change again.`,
    url: "Must be an http:// or https:// URL",
    day: "Must be a date, YYYY-MM-DD",
    email: "Must be an email address",
    updatedSince: "updatedSince must be an ISO date-time or YYYY-MM-DD",
    secret: (what: string) =>
      `Access notes look like they contain a secret (${what}). Write only where the secret lives, e.g. "FTP: AGENT_FTP_PASS in agent-secrets/.env", never the secret itself.`,
    domain: (value: string) => `"${value}" is not a public domain name`,
    siteInOtherProject: (domain: string) => `${domain} already belongs to another project`,
    siteNotYours: "Only the owner of a site can add it to a project",
    noUser: "No user with this email has signed in to this instance yet",
    lastOwner: "A project needs at least one owner",
    journalSite: "siteId is not a site of this project",
    taskKeyTaken: "Another task of this project already has this externalKey",
    bodyJson: "The body must be JSON",
    bodyTooLarge: (bytes: number) => `The body is over ${bytes} bytes`,
    multipart: "Send the file as multipart/form-data with a field named file",
    fileTooLarge: (mb: number) => `The file is over ${mb} MB`,
    fileEmpty: "The file is empty",
    fileType: (ext: string, allowed: string) =>
      `Files of type ${ext || "(none)"} are not accepted. Allowed: ${allowed}.`,
    fileContent: (ext: string) => `The file's content is not a ${ext} file`,
    method: "Method not allowed",
  },
} as const;
