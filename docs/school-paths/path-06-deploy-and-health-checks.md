# Path 06: Deploy & health checks

**Stage:** Finish → Ship  
**Goal:** A public https origin serves the API; `/health` is green; friends can bookmark something that still works after you close your laptop.

**Help packet:** [path-06-deploy-and-health-checks.md](../help-packets/path-06-deploy-and-health-checks.md)

## What can go wrong

“Works on my machine” never becomes a URL. Quick tunnels rotate; OAuth callbacks drift; nobody knows if the app or the tunnel died.

## Ask your AI to…

1. Pick one backend path (Worker+D1, Node+tunnel, etc.) — do not dual-write.
2. Set public / popout URLs to the https origin friends will open.
3. Keep `/health` cheap and dependency-light.
4. Run local smoke, then a short check on the deployed host.

## Prove it

- [ ] Friends can open a stable https URL (or you documented rotation).
- [ ] `/health` is green on that origin.
- [ ] Popout reaches the API as designed.

## Friend review questions

- Which service owns the hostname?
- Tunnel vs app — how do you tell them apart when health fails?
- Was a new paid plan required, or did you stay on free/already-paid tiers?
