import { useCallback, useEffect, useState } from "react";
import { App } from "./App";
import { OrganisationApp } from "./OrganisationApp";
import { HostedActivityPage } from "./HostedActivityPage";

function selectedView(): "company" | "showcase" | "activity" {
  const view = new URLSearchParams(location.search).get("view");
  if (view === "activity") return "activity";
  return location.pathname.startsWith("/sandbox") || view === "showcase"
    ? "showcase"
    : "company";
}

/** One website with two clearly labelled, independently authenticated data contexts. */
export function IdentityLens() {
  const [view, setView] = useState(selectedView);
  const navigate = useCallback((next: boolean) => {
    const url = new URL(location.href);
    url.pathname = "/";
    url.hash = "";
    if (next) url.searchParams.set("view", "showcase");
    else url.searchParams.delete("view");
    history.pushState({}, "", url.pathname + url.search);
    setView(next ? "showcase" : "company");
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const followHistory = () => setView(selectedView());
    window.addEventListener("popstate", followHistory);
    return () => window.removeEventListener("popstate", followHistory);
  }, []);
  useEffect(() => {
    document.title =
      view === "showcase"
        ? "Identity Lens — Sample cases"
        : view === "activity"
          ? "Identity Lens — Hosted activity"
          : "Identity Lens — Organisation workspace";
  }, [view]);
  return view === "activity" ? (
    <HostedActivityPage onOrganisation={() => navigate(false)} />
  ) : view === "showcase" ? (
    <App onOrganisation={() => navigate(false)} />
  ) : (
    <OrganisationApp onShowcase={() => navigate(true)} />
  );
}
