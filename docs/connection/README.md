# Connecting to the SGG Visualization dev servers

The backend (FastAPI/uvicorn) and frontend (Vite) run on a compute node
inside the Illinois Campus Cluster and are not directly reachable from
outside. Use an SSH port-forward through the cluster login node.

## Prerequisites

- An active SLURM allocation on the compute node (required for sshd to
  accept your login).
- Both dev servers running on the compute node:
  - backend: `uvicorn backend.main:app --host 0.0.0.0 --port 8888 --reload`
  - frontend: `npx vite --port 8889 --host 0.0.0.0`

## SSH tunnel

From your local machine:

```bash
ssh -L 8888:<compute_node>:8888 -L 8889:<compute_node>:8889 jtu9@cc-login.campuscluster.illinois.edu
```

Replace `<compute_node>` with the short hostname of the node your job is
on (e.g. `ccc0424`). Check with `squeue -u jtu9` or `echo $SLURM_JOB_ID`
while logged in.

Then open http://localhost:8889/ in your browser. The frontend talks to
the backend over `localhost:8888`, also forwarded through the same SSH
session.

### Known-working example

```bash
ssh -L 8888:ccc0424:8888 -L 8889:ccc0424:8889 jtu9@cc-login.campuscluster.illinois.edu
```

## Gotchas

- **Use the short hostname** (`ccc0424`), not the FQDN
  (`ccc0424.campuscluster.illinois.edu`). The FQDN resolves to the
  public interface (141.142.x.x) which the login node can't route to;
  the short name resolves to the internal HSN interface (172.29.x.x)
  which it can.
- If the tunnel hangs, verify reachability from the login node first:
  ```bash
  ssh jtu9@cc-login.campuscluster.illinois.edu
  nc -zv ccc0424 22     # must succeed
  nc -zv ccc0424 8889   # must succeed — else the app server isn't up
  ```
- If your SLURM job ends, sshd on the compute node will refuse new
  connections. Re-request an allocation before reconnecting.
- Local ports 8888/8889 must be free on your machine. Free them with
  `lsof -iTCP:8888` / `lsof -iTCP:8889` before retrying.

## ProxyJump alternative

If the direct `-L` via the login node still hangs, SSH into the compute
node itself through the login node and forward from there:

```bash
ssh -J jtu9@cc-login.campuscluster.illinois.edu \
    -L 8888:localhost:8888 -L 8889:localhost:8889 \
    jtu9@ccc0424
```
