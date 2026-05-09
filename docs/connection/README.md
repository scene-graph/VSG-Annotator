# Connecting to the dev servers from a remote machine

The backend (FastAPI/uvicorn) and frontend (Vite) bind to `0.0.0.0` on
ports `8888` and `8889` respectively. If they are running on a remote host
that is not directly reachable from your laptop, use an SSH port-forward.

## Prerequisites

- SSH access to the host running the dev servers.
- Both dev servers running:
  - backend: `uvicorn backend.main:app --host 0.0.0.0 --port 8888 --reload`
  - frontend: `npx vite --port 8889 --host 0.0.0.0`

## SSH tunnel

From your local machine:

```bash
ssh -L 8888:<host>:8888 -L 8889:<host>:8889 <user>@<remote>
```

Replace:

- `<host>` — hostname (or `localhost`) on the remote where the servers
  are bound.
- `<user>@<remote>` — your SSH login on the remote machine.

Then open http://localhost:8889/ in your browser. The frontend talks to
the backend over `localhost:8888`, also forwarded through the same SSH
session.

### Two-hop example (login node + compute node)

If the dev servers run on a compute node behind a login node, the
two-hop form is:

```bash
ssh -L 8888:<compute_node>:8888 -L 8889:<compute_node>:8889 <user>@<login_node>
```

If the cluster's compute-node SSH refuses external logins (some
schedulers attach `pam_slurm_adopt` or similar), use this plain
local-forward form rather than `ssh -J … <compute>` — the login-node
forward is sufficient because the login node can route to the compute
node over the internal network.

## Gotchas

- **Local ports 8888/8889 must be free** on your machine. Check with
  `lsof -iTCP:8888 -sTCP:LISTEN` and stop or rebind any conflicting
  process before retrying.
- **Use the short / internal hostname** for `<compute_node>` (e.g.
  `node-12`), not the public FQDN, when the login node only routes to
  the cluster-internal interface.
- If the tunnel hangs, verify reachability from the remote first:
  ```bash
  ssh <user>@<remote>
  nc -zv <host> 22         # SSH reachable
  nc -zv <host> 8888       # backend up
  nc -zv <host> 8889       # frontend up
  ```
- If the host is allocated through a job scheduler and your job ends,
  sshd on the host may refuse new connections. Re-request an allocation
  before reconnecting.
