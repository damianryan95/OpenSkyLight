# Local home deployment

> **Not the path in use.** `home-server` (`192.168.1.41`) runs a Portainer
> **Repository stack** that clones this repository and builds it itself, and
> publishes OpenSkyLight on **port 6123** — `http://192.168.1.41:6123`. See
> `compose.yaml` and "Current deployment status" in
> [`delivery-plan.md`](../delivery-plan.md). Work must be pushed to reach it.
>
> What follows is the alternative SSH-context path, which builds the local
> working tree instead. Its `192.168.200.32:3000` defaults name a Docker VM
> that is not on the current home network; override `OSL_DEPLOY_HOST` before
> trusting them.

This deployment path is intentionally local. It does not push to the upstream
`lowerygt/OpenSkyLight` repository, use GitHub Actions, or require a container
registry. The current working tree is checked, built, and sent to the Docker VM
through an SSH Docker context.

## One-time setup

From the developer machine, create the context using the VM account and address:

```fish
docker context create openskylight-home \
  --docker host=ssh://osl-deploy@192.168.200.32
docker --context openskylight-home ps
```

The `osl-deploy` account needs permission to run Docker without `sudo`.

## Deploy

Run from the repository root:

```fish
npm run deploy:home
```

The command runs typechecking, unit tests, and the production build; creates an
online SQLite backup when an OpenSkyLight container already exists; builds the
image on the VM; starts the Compose project named `openskylight`; and waits for
`http://192.168.200.32:3000/health/ready`.

Backups are written to the local, ignored `backups/` directory. The persistent
Docker volume remains on the VM and is not removed during deployment.

The host, Docker context, listen address, health URL, and Compose project can be
overridden with `OSL_DEPLOY_HOST`, `OSL_DEPLOY_CONTEXT`, `OSL_LISTEN_ADDRESS`,
`OSL_DEPLOY_HEALTH_URL`, and `OSL_COMPOSE_PROJECT` respectively.
