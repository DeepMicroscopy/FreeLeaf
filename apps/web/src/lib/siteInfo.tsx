import { api } from "@freeleaf/shared";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

interface SiteInfoContextValue {
  /** Shown next to the leaf icon in place of the literal "FreeLeaf" text
   * (Plan.md §9 Phase 11, admin-configurable) — defaults to "FreeLeaf"
   * while the public `/api/site-info` fetch is still in flight, so nothing
   * ever renders blank waiting on it. */
  siteName: string;
  /** Who can contribute new templates — governs whether the "Contribute a
   * template" entry point is shown to the current (possibly non-admin)
   * user at all. Defaults to the same "admin_only" the backend model
   * defaults to, so nothing flashes open then closes while loading. */
  templateContributionMode: "admin_only" | "review_required" | "open";
}

const SiteInfoContext = createContext<SiteInfoContextValue>({
  siteName: "FreeLeaf",
  templateContributionMode: "admin_only",
});

export function SiteInfoProvider({ children }: { children: ReactNode }) {
  const [siteName, setSiteName] = useState("FreeLeaf");
  const [templateContributionMode, setTemplateContributionMode] =
    useState<SiteInfoContextValue["templateContributionMode"]>("admin_only");

  useEffect(() => {
    api.GET("/api/site-info").then(({ data }) => {
      if (data) {
        setSiteName(data.site_name);
        setTemplateContributionMode(data.template_contribution_mode as SiteInfoContextValue["templateContributionMode"]);
      }
    });
  }, []);

  return (
    <SiteInfoContext.Provider value={{ siteName, templateContributionMode }}>{children}</SiteInfoContext.Provider>
  );
}

export function useSiteInfo(): SiteInfoContextValue {
  return useContext(SiteInfoContext);
}
