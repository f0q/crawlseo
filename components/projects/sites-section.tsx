"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PROJECT_MESSAGES as M } from "@/lib/projects/messages";
import { ErrorLine, Field, inputClass, projectUrl, Section, send, textareaClass, useAction } from "./ui";

const T = M.sites;

type ProjectSite = { id: string; domain: string; gscProperty: string | null; yours: boolean };

/** The project's sites: open your own, add domains, link one of your sites, take one out. */
export function SitesSection({
  slug,
  sites,
  linkable,
  canEdit,
}: {
  slug: string;
  sites: ProjectSite[];
  /** Your sites in no project, to link. */
  linkable: { id: string; domain: string }[];
  canEdit: boolean;
}) {
  const [domains, setDomains] = useState("");
  const [siteId, setSiteId] = useState("");
  const { busy, error, run } = useAction();

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await run("add", () => send(projectUrl(slug, "sites"), "POST", { domains: domains.split(/[\s,]+/).filter(Boolean) }));
    if (r) setDomains("");
  }

  async function link() {
    if (!siteId) return;
    const r = await run("link", () => send(projectUrl(slug, "sites"), "POST", { siteId }));
    if (r) setSiteId("");
  }

  return (
    <Section title={T.title} description={T.description}>
      {sites.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{T.empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {sites.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-data text-[14px] text-text-strong">{s.domain}</p>
                <p className="font-data text-[12px] text-muted-foreground">{s.yours ? s.gscProperty ?? T.noGsc : T.notYours}</p>
              </div>
              <div className="flex items-center gap-2">
                {s.yours && (
                  <Link href={`/sites/${s.id}`} className="text-[13px] text-link hover:underline">
                    {T.open}
                  </Link>
                )}
                {canEdit && (
                  <Button variant="ghost" size="xs" disabled={busy !== null} onClick={() => run(s.id, () => send(projectUrl(slug, "sites", s.id), "DELETE"))}>
                    {T.remove}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-5 flex flex-col gap-4 border-t border-border pt-4">
          <form onSubmit={add} className="flex flex-col gap-3">
            <Field label={T.addDomains} hint={T.addDomainsHint}>
              <textarea className={textareaClass} rows={2} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com" required />
            </Field>
            <div>
              <Button type="submit" variant="outline" disabled={busy !== null}>
                {busy === "add" ? T.adding : T.add}
              </Button>
            </div>
          </form>
          {linkable.length > 0 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label={T.linkExisting} className="flex-1">
                <select className={inputClass} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  <option value="">{T.pickSite}</option>
                  {linkable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.domain}
                    </option>
                  ))}
                </select>
              </Field>
              <Button variant="outline" onClick={link} disabled={busy !== null || !siteId}>
                {T.link}
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="mt-3">
        <ErrorLine error={error} />
      </div>
    </Section>
  );
}
