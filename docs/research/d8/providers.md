# D8: Where should long-lived Atlas agent-loop workers run?

Decision context: move each cloud session's agent loop out of the Vercel Sandbox and onto
long-lived workers. Hard requirements: long-lived inbound WebSockets/SSE (client streams held
for hours; model streams of several minutes), outbound long-lived WebSocket worker → sandbox,
Bun runtime, low latency to Vercel Sandbox (AWS `iad1` / us-east-1), graceful deploys that
don't drop running loops (draining / zero-downtime), autoscaling or easy horizontal scaling,
sane pricing for many mostly-idle concurrent connections.

Sources are official docs/pricing pages fetched 2026-11-02.

## Comparison table

|                          | Render                                                                                                         | Fly.io                                                                                                                                                                     | Railway                                                                                                                                                                  | AWS ECS Fargate (+ALB)                                                                                                                                                                       | AWS App Runner                                                                      | Google Cloud Run                                                                                                                           | Northflank                                                                                                  | Koyeb                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **WS/SSE limits**        | No max WS duration; closes only on instance shutdown. No conn-count limit.                                     | No max WS duration; configurable proxy `idle_timeout` (e.g. 600s); no request-duration cap.                                                                                | WS exempt from duration + inactivity limits — "can stay open indefinitely, even while idle"; plain HTTP capped at 15 min w/ traffic, 5 min idle. 10,000 conns/domain.    | ALB idle timeout 60s default, max 4000s (~66 min) — requires ≤66-min heartbeats for hour-long idle streams. No request cap beyond idle.                                                      | 120s request timeout — **disqualifying**. Also closed to new customers (Nov 2025+). | Request timeout max **60 min** applies to WS — hour-long client streams would be dropped; needs client reconnect. 1000 conns/instance.     | WS/gRPC supported over HTTP/1.1+2 ingress; no documented duration/idle limit found.                         | WS via HTTP ports; no documented duration/idle limit found.                                                                             |
| **Deploy draining**      | Zero-downtime; SIGTERM → 30s grace, extensible to **300s max** (support for more).                             | rolling/canary/**bluegreen**; bluegreen cords old Machines (stops new traffic) — old keep serving live conns until done; `kill_timeout` max 300s.                          | Zero-downtime overlap; old deploy SIGTERMed with **0s grace by default**, configurable via `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` + `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`. | ALB deregistration delay 0–3600s (draining); ECS SIGTERM + `stopTimeout` (default 30s, max **120s** on Fargate).                                                                             | Rolling; no user-controlled drain.                                                  | SIGTERM → **10s** before SIGKILL; in-flight requests "given time to complete" but no documented guaranteed drain window.                   | Rolling; canary rollouts available; drain window not documented (Kubernetes underneath).                    | Rolling; drain not documented.                                                                                                          |
| **Region near iad1**     | Virginia (AWS us-east-1)                                                                                       | `iad` Ashburn VA — same metro as iad1                                                                                                                                      | US East Metal (Virginia, Equinix DC)                                                                                                                                     | us-east-1 — same region                                                                                                                                                                      | us-east-1                                                                           | us-east1 (S. Carolina, ~1-2ms extra) or nearest                                                                                            | us-east-ohio, us-east1(GCP) — not us-east-1; BYOC on own AWS us-east-1 possible                             | `aws-us-east-1` core region — literally same AWS region                                                                                 |
| **Bun support**          | Native (bun.lock detection, `BUN_VERSION`, default 1.4.4)                                                      | Docker (`oven/bun` image)                                                                                                                                                  | Docker (`oven/bun` image); Railpack doesn't auto-detect Bun                                                                                                              | Docker (any image)                                                                                                                                                                           | Docker                                                                              | Docker                                                                                                                                     | Dockerfile                                                                                                  | Dockerfile / native Bun guide                                                                                                           |
| **Scaling**              | Horizontal autoscaling (Pro+, CPU/mem targets)                                                                 | Machines API + autostop/autostart; manual/Metric-based scale                                                                                                               | Manual replicas up to 42 (Pro); autoscale not standard                                                                                                                   | ECS Service Autoscaling                                                                                                                                                                      | Built-in autoscaling                                                                | 0→1000+ instances, concurrency 1000/instance                                                                                               | Autoscaling on pay-as-you-go                                                                                | Autoscaling incl. scale-to-zero                                                                                                         |
| **Pricing model**        | Per instance/mo prorated to sec; 1 CPU/2GB = $25/mo; +$25/mo Pro fee                                           | Per-second; shared-1x/1GB ≈ $6.70/mo (iad); perf-1x/2GB = $33/mo; egress $0.02/GB                                                                                          | Usage: $20/vCPU + $10/GB per month; $20/mo Pro sub w/ $20 included usage                                                                                                 | vCPU $0.04048/h + GB $0.004445/h ≈ $35/mo for 1vCPU/2GB per task; + ALB ~$22/mo + LCU                                                                                                        | vCPU $0.064/h + GB $0.007/h w/ idle-instances cheaper                               | Instance-based billing (WS): $0.000018/vCPU-s + $0.000002/GiB-s ≈ $53/mo for 1vCPU/2GiB always-on (us-central1); idle min-instance cheaper | $0.01667/vCPU-h + $0.00833/GB-h → 1vCPU/2GB ≈ $24/mo; no seat fee; egress $0.06/GB                          | Per-second instance pricing; eco instances ~$1.61/mo; free tier exists                                                                  |
| **Notable limits/notes** | Shutdown delay cap 300s is the binding constraint for hour-long sessions; LB assigns WS randomly per instance. | Best fit for long conns: bluegreen deploys + cordon let old Machines drain indefinitely; Machines API gives per-loop VM control (Fly itself markets this for agent infra). | Docs explicitly bless indefinite WS; but 0s default drain must be configured; region is Equinix metal not AWS — still Virginia.                                          | Full control (best deploy draining of the set), highest ops burden; ALB 4000s idle cap requires keepalives; Fargate stopTimeout 120s caps task drain after SIGTERM (use ALB draining first). | Excluded: 120s cap + closed to new customers.                                       | 60-min WS cap is a hard mismatch for "client streams held for hours"; 10s SIGTERM window.                                                  | No published WS timeout limits; BYOC could land workloads in own AWS us-east-1 VPC; verify drain semantics. | Recently acquired by Mistral AI (continuity question); aws-us-east-1 region unique among PaaS; least documented drain/timeout behavior. |

## Key facts by provider (with sources)

### Render

- WS: "Render does not enforce a maximum duration for WebSocket connections… they close automatically when the instance is replaced"; no limit on open WS count; LB assigns each WS to a random instance. https://render.com/docs/websocket
- Deploy: zero-downtime; SIGTERM with default 30s shutdown delay, max **300s** (longer requires support ticket). https://render.com/docs/deploys
- Regions: Oregon, Ohio, **Virginia**, Frankfurt, Singapore. https://render.com/docs/regions
- Bun: native runtime, `BUN_VERSION`/`.bun-version`, default 1.4.4. https://render.com/docs/bun-version
- Pricing: per-service monthly prorated to second; 1 CPU/2GB $25/mo, 2 CPU/4GB $85/mo; Pro workspace $25/mo; horizontal autoscaling on Pro. https://render.com/pricing

### Fly.io

- Proxy: configurable `http_options.idle_timeout` (example 600s); TCP passthrough available; no documented WS duration cap. https://docs.fly.io/reference/configuration
- Deploy: strategies rolling/immediate/canary/**bluegreen**; bluegreen cordons old Machines so live connections drain while new take traffic; `kill_timeout` max 300s (best-effort). https://docs.fly.io/launch/deploy , https://docs.fly.io/blueprints/seamless-deployments
- Region: `iad` Ashburn, Virginia. https://docs.fly.io/reference/regions
- Pricing: per-second; shared-cpu-1x 1GB $6.70/mo (iad), performance-2x/4GB $66/mo; stopped Machines only rootfs ($0.15/GB/mo); egress $0.02/GB NA. https://docs.fly.io/about/pricing
- Bun: via Dockerfile (`oven/bun`); no native buildpack found in docs.
- Note: Fly explicitly positions Machines for per-user agent/dev-env workloads (Sprites, per-user-dev-environments blueprint).

### Railway

- Networking: "Websocket connections are exempt from these duration and inactivity limits, and can stay open indefinitely, even while idle"; HTTP requests max 15 min active / 5 min idle; 10,000 concurrent connections per domain. https://docs.railway.com/networking/public-networking/specs-and-limits
- Deploy: new deploy overlaps old; old gets SIGTERM with **0s default** grace; configurable via `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` and `RAILWAY_DEPLOYMENT_OVERLAP_SECONDS`. https://docs.railway.com/deployments/reference
- Regions: US East Metal (Virginia), US West, EU West, SE Asia. https://docs.railway.com/deployments/regions
- Bun: Docker required; Railpack does not auto-detect Bun. https://railway.com/guides/bun
- Pricing: $20/vCPU/mo + $10/GB/mo + $0.05/GB egress; Pro $20/mo subscription with $20 usage included; Pro max 42 replicas/service. https://docs.railway.com/pricing/plans

### AWS ECS Fargate + ALB

- ALB idle timeout default 60s, configurable **1–4000s** — hour-long idle WS/SSE need keepalives under 66 min. https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html
- Draining: ALB `deregistration_delay.timeout_seconds` 0–3600s (default 300s) — in-flight requests/connections complete. https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html
- ECS `stopTimeout`: SIGTERM grace max **120s** on Fargate platform. https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
- Pricing (us-east-1): $0.04048/vCPU-h + $0.004445/GB-h (≈$35/mo for 1vCPU/2GB task); ALB ~$22/mo + LCU; Service Autoscaling standard. https://aws.amazon.com/fargate/pricing/
- Region: us-east-1 — same region as Vercel Sandbox, lowest latency of the set.
- Bun: any container image.

### AWS App Runner

- **Excluded**: 120s total request timeout; docs say stateful/long connections unsupported; and App Runner is closed to new customers (AWS recommends ECS Express Mode). https://docs.aws.amazon.com/apprunner/latest/dg/develop.html , https://docs.aws.amazon.com/apprunner/latest/dg/getting-started.html

### Google Cloud Run

- WS are "subject to the request timeout… currently up to 60 minutes" — hour-long streams get cut; clients must reconnect. 1000 concurrent requests/instance; instance with any open WS is billed (instance-based billing). https://docs.cloud.google.com/run/docs/triggering/websockets , https://docs.cloud.google.com/run/quotas
- Shutdown: SIGTERM → **10s** → SIGKILL; in-flight requests "given time to complete" but window not configurable. https://docs.cloud.google.com/run/docs/container-contract
- Pricing: instance-based $0.000018/vCPU-s + $0.000002/GiB-s (≈$53/mo per always-on 1vCPU/2GiB, us-central1); CUDs available. https://cloud.google.com/run/pricing
- Regions: no us-east-1; closest us-east1/us-east4/us-east5.
- Bun: container only.

### Northflank

- Networking: HTTP/1.1+2 ingress incl. WebSockets and gRPC; no documented WS duration/idle limit in public docs (needs verification). https://northflank.com/docs/v1/application/network/configure-ports , https://northflank.com/docs/v1/application/network/networking-on-northflank
- Regions: us-east-ohio, us-east1 (GCP SC), etc.; **BYOC** lets you run in your own AWS account (us-east-1 possible). https://northflank.com/docs/v1/application/run/deploy-to-a-region
- Pricing: $0.01667/vCPU-h + $0.00833/GB-h, billed per second, no seat fee; 1vCPU/2GB ≈ $24/mo; egress $0.06/GB. https://northflank.com/pricing
- Autoscaling + canary rollouts documented; drain semantics not documented. Bun via Dockerfile.

### Koyeb (other strong fit)

- Core regions include **`aws-us-east-1`** — runs in the same AWS region as Vercel Sandbox; native Bun quickstart. https://www.koyeb.com/docs/reference/regions , https://www.koyeb.com/docs/deploy/bun
- Per-second billing, autoscaling, scale-to-zero; WS supported over HTTP ports; no published duration/idle limits or drain documentation found. https://www.koyeb.com/docs/faqs/pricing
- Caveat: acquired by Mistral AI (announced on docs banner, 2026) — platform continuity risk.

## Recommendation

1. **Fly.io (`iad`)** is the best fit. It is the only PaaS here with all of: no WS duration cap, an
   official bluegreen strategy that cordons old Machines so live WebSockets drain on their own
   schedule, per-second pricing that is cheap for mostly-idle connection-heavy VMs
   (shared-1x/1GB ≈ $6.70/mo in iad), Machines in Ashburn (same metro as Vercel Sandbox iad1),
   and a control plane (Machines API) designed for per-session agent VMs. Bun runs fine in a
   container. The 300s `kill_timeout` cap is fine because bluegreen keeps old Machines alive
   until the deploy finishes — loops that outlive a deploy ride the old Machine.
2. **AWS ECS Fargate + ALB (us-east-1)** is the runner-up and the lowest-latency/most-control
   option: ALB draining up to 3600s is the most generous deploy semantics anywhere here, and
   us-east-1 is the sandbox region itself. Costs: real ops burden, ALB idle-timeout ceiling of
   4000s (needs ≤66-min keepalives — Atlas already pings), and ~2× the per-vCPU price of Fly
   for always-on tasks.
3. **Railway** is a credible dark horse — the only provider whose docs explicitly guarantee
   indefinite idle WebSockets — but drains with 0s grace by default (must set
   `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`) and its US East region is Equinix metal, not AWS.
4. **Render** works (no WS duration cap, Virginia region, native Bun, autoscaling) but the hard
   300s shutdown-delay cap means a deploy kills any loop/stream older than 5 minutes unless
   support grants an exception.
5. **Cloud Run** (60-min WS cap, 10s SIGTERM) and **App Runner** (120s cap, closed to new
   customers) do not meet the streaming requirements.
6. **Northflank** and **Koyeb** are worth a spike only if Fly/AWS disappoint: Northflank for
   BYOC-into-us-east-1, Koyeb for its literal `aws-us-east-1` region — both lack documented
   long-connection and drain guarantees.
