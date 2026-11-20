import Link from "next/link";
import { HandHeart, ShieldCheck } from "lucide-react";
import "swagger-ui-dist/swagger-ui.css";
import { ApiConsole } from "./ApiConsole";

export default function Docs() {
  return <><header className="topbar"><div className="topbar-inner">
    <Link className="brand" href="/"><span className="brand-mark"><HandHeart size={22} /></span><strong>Relief Claim Assist</strong></Link>
    <span className="disclosure"><ShieldCheck size={14} />PROTOTYPE · SIMULATED DPI DATA</span>
  </div></header><main className="content">
    <div className="section-heading"><div><h1 className="large-copy">Relief Claim Assist API</h1><p>Simulated DPI · OpenAPI 3.1</p></div><Link className="text-link" href="/api/openapi.json">OpenAPI JSON</Link></div>
    <ApiConsole />
  </main></>;
}
