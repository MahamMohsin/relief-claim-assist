"use client";
import { useEffect, useRef, useState } from "react";

export function ApiConsole() {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading interactive API documentation…");

  useEffect(() => {
    const domNode = container.current;
    if (!domNode) return;
    let active = true;
    import("swagger-ui-dist/swagger-ui-bundle.js").then(({ default: swagger }) => {
      if (!active) return;
      swagger({ domNode, url: "/api/openapi.json", validatorUrl: null, deepLinking: true, persistAuthorization: false });
      setStatus("");
    }).catch(() => { if (active) setStatus("Interactive documentation unavailable. The OpenAPI JSON link remains available."); });
    return () => { active = false; domNode.replaceChildren(); };
  }, []);

  return <section className="panel">{status && <p role="status">{status}</p>}<div ref={container} /></section>;
}
