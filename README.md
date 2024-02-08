# ⚠️ Deprecation Notice
We've since iterated on other solutions for using Buildkite with k8s. Please check out [github.com/buildkite/agent-stack-k8s](https://github.com/buildkite/agent-stack-k8s) for a supported solution. We'll continue to accept PRs for this repository, but won't be doing any active maintenance. 

# Buildkite Helm Charts Repository 

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Release](https://img.shields.io/github/release/buildkite/charts.svg?style=flat-square)](https://github.com/buildkite/charts/releases/latest)
[![Build status](https://badge.buildkite.com/f0a51d12ea264f0cdbcbb70a6809019cc11a05580e72ff83ef.svg?branch=master)](https://buildkite.com/buildkite/helm-charts)

The official [Buildkite](https://buildkite.com/docs/agent) [Helm](https://helm.sh) Charts repository.

## Getting Started

### Install Helm

Get the latest [Helm release](https://github.com/kubernetes/helm#install).

### Add Buildkite Helm chart repository:

 ```console
 helm repo add buildkite https://buildkite.github.io/charts/
 helm repo update
 ```

### Install chart

To install the Agent chart with the release name `bk-agent`:

```console
helm install --name bk-agent --namespace buildkite buildkite/agent --set agent.token="BUILDKITE_AGENT_TOKEN"
```

Check Agent chart [readme](stable/agent/README.md) for more customisation options.

** You’ve now got Buildkite Agents running on your Kubernetes cluster! :tada: **

## Contributing to Buildkite Charts

Fork the `repo`, make changes and test it by installing the chart to see it is working. :)

On success make a [pull request](https://help.github.com/articles/using-pull-requests) (PR).

Upon successful review, someone will give the PR a __LGTM__ in the review thread.

## Thanks :heart:

* A massive thanks to [Rimas Mocevicius](https://github.com/rimusz) for authoring Buildkite Agent chart.

## Copyright

Copyright (c) 2020 Buildkite Pty Ltd. See [LICENSE](LICENSE) for details.
