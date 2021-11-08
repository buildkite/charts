# Running Buildkite agent

The [buildkite agent](https://buildkite.com/docs/agent) is a small, reliable and cross-platform build runner that makes it easy to run automated builds on your own infrastructure. Its main responsibilities are polling buildkite.com for work, running build jobs, reporting back the status code and output log of the job, and uploading the job's artifacts.
It is simple, lightweight hosted [Buildkite](https://buildkite.com) CI/CD system which only requires to host agents in your Kubernetes cluster.

## Introduction

This chart bootstraps a [buildkite agent](https://github.com/buildkite/docker-buildkite-agent) builder on a [Kubernetes](http://kubernetes.io) cluster using the [Helm](https://helm.sh) package manager.
As it sets `service account` it can be used to build Docker images and deploy them using `kubectl` and `helm` clients in the same cluster where agents run, without any extra setup.

## Add Buildkite Helm chart repository:

 ```console
 helm repo add buildkite https://buildkite.github.io/charts/
 helm repo update
 ```

## Installing the Chart

In order for the chart to configure the Buildkite Agent properly during the installation process, you must provide some minimal configuration which can't rely on defaults. This includes at least one element in the _agent_ list `token`:

To install the chart with the release name `bk-agent`:

```console
helm install --name bk-agent --namespace buildkite buildkite/agent \
    --set agent.token="BUILDKITE_AGENT_TOKEN"
```

To install the chart with the release name `bk-agent` and set Agent tags and git repo SSH key:

```console
helm install --name bk-agent --namespace buildkite buildkite/agent \
  --set agent.token="$(cat buildkite.token)",agent.tags="role=production" \
  --set privateSshKey="$(cat buildkite.key)"  \
  --set registryCreds.gcrServiceAccountKey="$(cat gcr_service_account.key | base64)"
```

> **Note**: if your pipeline uses docker for build images or run containers, you must set `dind.enabled` to `true`.

Where `--set` values contain:
```
agentToken: Buildkite token read from file
agentMeta: tagging agent with - role=production (to add multiple tags, you must separate them with an escaped comma, like this: role=production\,queue=kubernetes)
privateSshKey: private SSH key read from file
registryCreds.gcrServiceAccountKey: base64 encoded gcr_service_account.key json file
```

> **Tip**: List all releases using `helm list`

## Uninstalling the Chart

To uninstall/delete the `bk-agent` release:

```console
helm delete bk-agent
```

The command removes all the Kubernetes components associated with the chart and deletes the release.

## Configuration

The following table lists the configurable parameters of the `buildkite` chart and their default values.

Parameter | Description | Default
--- | --- | ---
`replicaCount` | Replicas count | 1
`image.repository` | Image repository | `buildkite/agent`
`image.tag` | Image tag | ``
`image.pullPolicy` | Image pull policy | `IfNotPresent`
`agent.token` | Agent token | Must be specified
`agent.tags` | Agent tags | `role=agent`
`enableHostDocker` | Mount docker socket | `true`
`podSecurityContext` | Pod security context to set | `{}`
`securityContext` | Container security context to set | `{}`
`hostIPC` | Use the host's ipc namespace | `false`
`hostNetwork` | Use the host's network namespace. If this option is set, the ports that will be used must be specified | `false`
`hostPID` | Use the host's pid namespace | `false`
`extraEnv` | Agent extra env vars | `nil`
`privateSshKey` | Agent ssh key for git access | `nil`
`registryCreds.gcrServiceAccountKey` | GCP Service account json key | `nil`
`registryCreds.dockerConfig` | Private registry docker config.json | `nil`
`entrypointd` | Add files to /docker-entrypoint.d/ via a ConfigMap | `{}`
`serviceAccount.annotation` | Extra annotations for the generated ServiceAccount | `{}`
`rbac.create` | Whether to create RBAC resources to be used by the pod | `false`
`rbac.role.rules` | List of rules following the role specification | See [values.yaml](values.yaml)
`volumeMounts` | Extra volumeMounts configuration | `nil`
`volumes` | Extra volumes configuration | `nil`
`resources` | Liveness probe for docker socket | `{}`
`livenessProbe` | Pod resource requests & limits | `{}`
`nodeSelector` | Node labels for pod assignment | `{}`
`tolerations` | Node tolerations for pod assignment | `{}`
`affinity` | Node/pod affinity | `{}`
`podAnnotations` | Extra annotation to apply to the pod | `{}`
`podContainers` | Extra pod container or sidecar configuration | `nil`
`dind.enabled` | Enable preconfigured Docker-in-Docker (DinD) pod configuration | `false`
`dind.image` | Image to use for Docker-in-Docker (DinD) pod container | `docker:19.03-dind`
`dind.port` | Port Docker-in-Docker (DinD) daemon listens on as REST request proxy | `2375`
`dind.resources` | Pod resource requests & limits for dind sidecar (if enabled) | `{}`
`terminationGracePeriodSeconds` | Duration in seconds the pod needs to terminate gracefully | `30`

Specify each parameter using the `--set key=value[,key=value]` argument to `helm install`.

Alternatively, a YAML file that specifies the values for the above parameters can be provided while installing the chart. For example:

```console
helm install --name bk-agent --namespace buildkite buildkite/agent -f values.yaml 
```

> **Tip**: You can use the default [values.yaml](values.yaml) file

## Buildkite pipeline examples

Check for examples of `pipeline.yml` and `build/deploy` scripts [here](pipeline-examples).


## Adding agent hooks to agent pods

Adding your own hooks (e.g. environment hooks) depends on whether you use DinD or not.

#### Without Docker-in-Docker
Without using DinD, you can follow the lower part of the guide [here](https://buildkite.com/docs/agent/v3/docker#adding-hooks) 

#### With Docker-in-Docker
As the hooks directory is set to a shared dir, currently the best way to add your own hooks while using DinD consists of two steps.
1. Follow the guide above for usage without DinD.
2. Add an entrypoint script to your values.yml that copies the hooks from the image to the shared dir. E.g:

```
entrypointd: 
  01-copy-hooks: |
    #!/bin/sh
    set -euo pipefail
    mkdir -p /var/buildkite/hooks
    cp /buildkite/hooks/* /var/buildkite/hooks/.
```
