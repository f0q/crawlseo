"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { PROJECT_STATUSES } from "@/lib/projects/schema";
import { findSecret } from "@/lib/projects/secrets";
import type { GroupOption } from "@/lib/projects/group-names";
import { GroupSelect, ProjectGroupPicker } from "./group-select";
import { ErrorLine, Field, inputClass, projectUrl, send, textareaClass, useAction } from "./ui";

const T = M.form;

export type Passport = {
  slug: string;
  name: string;
  status: string;
  group?: string | null;
  testUrl: string | null;
  geo: string | null;
  language: string | null;
  searchEngines: string[];
  cms: string | null;
  hosting: string | null;
  contacts: string | null;
  accessNotes: string | null;
};

const EMPTY: Passport = {
  slug: "",
  name: "",
  status: "client",
  group: null,
  testUrl: null,
  geo: null,
  language: null,
  searchEngines: [],
  cms: null,
  hosting: null,
  contacts: null,
  accessNotes: null,
};

/**
 * The passport form: creates a project (with its domains) or edits one. The
 * group of an existing project is saved on its own, as soon as it is picked. A
 * viewer sees the same fields, read-only. Access notes are checked for
 * secrets as you type, with the server's rules.
 */
export function ProjectForm({ project, canEdit = true, groups = [] }: { project?: Passport; canEdit?: boolean; groups?: GroupOption[] }) {
  const router = useRouter();
  const creating = !project;
  const [v, setV] = useState<Passport>(project ?? EMPTY);
  const [engines, setEngines] = useState((project?.searchEngines ?? []).join(", "));
  const [domains, setDomains] = useState("");
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  const set = (key: keyof Passport) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setSaved(false);
    setV((prev) => ({ ...prev, [key]: e.target.value }));
  };
  const secret = v.accessNotes ? findSecret(v.accessNotes) : null;
  const disabled = !canEdit || busy !== null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      name: v.name,
      status: v.status,
      testUrl: v.testUrl,
      geo: v.geo,
      language: v.language,
      searchEngines: engines.split(",").map((s) => s.trim()).filter(Boolean),
      cms: v.cms,
      hosting: v.hosting,
      contacts: v.contacts,
      accessNotes: v.accessNotes,
    };
    if (creating) {
      const r = await run(
        "save",
        () =>
          send<{ project: { slug: string } }>("/api/projects", "POST", {
            ...body,
            ...(v.slug.trim() && { slug: v.slug.trim() }),
            group: v.group ?? null,
            domains: domains.split(/[\s,]+/).filter(Boolean),
          }),
        { refresh: false }
      );
      if (r) router.push(`/projects/${r.project.slug}`);
      return;
    }
    const r = await run("save", () => send(projectUrl(project.slug), "PATCH", body));
    if (r) setSaved(true);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {!canEdit && <p className="text-[13px] text-muted-foreground">{T.readOnly}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={T.name}>
          <input className={inputClass} value={v.name} onChange={set("name")} required maxLength={120} disabled={disabled} />
        </Field>
        {creating ? (
          <Field label={T.slug} hint={T.slugHint}>
            <input className={inputClass} value={v.slug} onChange={set("slug")} pattern="[a-z0-9][a-z0-9\-]{0,46}[a-z0-9]" maxLength={48} disabled={disabled} />
          </Field>
        ) : (
          <Field label={T.slug}>
            <input className={inputClass} value={v.slug} disabled readOnly />
          </Field>
        )}
        <Field label={T.status}>
          <select className={inputClass} value={v.status} onChange={set("status")} disabled={disabled}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {M.labels.status[s]}
              </option>
            ))}
          </select>
        </Field>
        {/* Agency fork: the group picker. Creating, it goes with the form; editing, it saves on its own (ProjectGroupPicker). */}
        <div className="flex flex-col gap-1">
          <span id="project-group-label" className="mono-label text-[11px] text-muted-foreground">
            {T.group}
          </span>
          {creating ? (
            <GroupSelect value={v.group ?? null} groups={groups} onChange={(group) => setV((prev) => ({ ...prev, group }))} disabled={disabled} labelledBy="project-group-label" />
          ) : (
            <ProjectGroupPicker slug={project.slug} value={project.group ?? null} groups={groups} canEdit={canEdit} labelledBy="project-group-label" />
          )}
          {creating && <span className="text-[12px] leading-4 text-muted-foreground">{T.groupHint}</span>}
        </div>
        <Field label={T.testUrl} hint={T.testUrlHint}>
          <input className={inputClass} type="url" value={v.testUrl ?? ""} onChange={set("testUrl")} placeholder="https://" disabled={disabled} />
        </Field>
        <Field label={T.geo}>
          <input className={inputClass} value={v.geo ?? ""} onChange={set("geo")} placeholder={T.geoPlaceholder} disabled={disabled} />
        </Field>
        <Field label={T.language}>
          <input className={inputClass} value={v.language ?? ""} onChange={set("language")} placeholder={T.languagePlaceholder} disabled={disabled} />
        </Field>
        <Field label={T.searchEngines} hint={T.searchEnginesHint}>
          <input className={inputClass} value={engines} onChange={(e) => setEngines(e.target.value)} disabled={disabled} />
        </Field>
        <Field label={T.cms}>
          <input className={inputClass} value={v.cms ?? ""} onChange={set("cms")} disabled={disabled} />
        </Field>
        <Field label={T.hosting}>
          <input className={inputClass} value={v.hosting ?? ""} onChange={set("hosting")} disabled={disabled} />
        </Field>
        <Field label={T.contacts} hint={T.contactsHint}>
          <textarea className={textareaClass} rows={3} value={v.contacts ?? ""} onChange={set("contacts")} disabled={disabled} />
        </Field>
        <Field label={T.accessNotes} hint={T.accessNotesHint} className="md:col-span-2">
          <textarea
            className={textareaClass}
            rows={3}
            value={v.accessNotes ?? ""}
            onChange={set("accessNotes")}
            aria-invalid={secret ? true : undefined}
            disabled={disabled}
          />
        </Field>
        {secret && (
          <div className="md:col-span-2">
            <ErrorLine error={M.errors.secret(secret.reason)} />
          </div>
        )}
        {creating && (
          <Field label={T.domains} hint={T.domainsHint} className="md:col-span-2">
            <textarea className={textareaClass} rows={3} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com" disabled={disabled} />
          </Field>
        )}
      </div>
      <ErrorLine error={error} />
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy !== null || secret !== null}>
            {creating ? (busy ? T.creating : T.create) : busy ? T.saving : T.save}
          </Button>
          {creating && (
            <Link href="/projects" className="text-[13px] text-muted-foreground hover:text-text-strong">
              {T.cancel}
            </Link>
          )}
          {saved && <span className="text-[13px] text-success">{T.saved}</span>}
        </div>
      )}
    </form>
  );
}
