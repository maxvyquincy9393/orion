# Kubernetes / Helm

This directory contains the Helm chart for deploying EDITH to a Kubernetes cluster.

## Structure

```
k8s/
  helm/
    Chart.yaml          — chart metadata
    values.yaml         — default values (dev/staging)
    values.prod.yaml    — production overrides
    templates/
      _helpers.tpl      — shared template helpers
      configmap.yaml    — non-secret env vars
      deployment.yaml   — main workload
      hpa.yaml          — HorizontalPodAutoscaler (enabled in prod)
      ingress.yaml      — optional Ingress
      pdb.yaml          — PodDisruptionBudget (enabled in prod)
      pvc.yaml          — PersistentVolumeClaim for SQLite + workspace
      service.yaml      — ClusterIP service (http + metrics ports)
      serviceaccount.yaml
```

## Prerequisites

- Kubernetes 1.25+
- Helm 3.12+
- An existing Kubernetes secret `edith-secrets` with all API keys (see below)

## Creating the secrets

```bash
kubectl create secret generic edith-secrets \
  --from-literal=ANTHROPIC_API_KEY="sk-ant-..." \
  --from-literal=OPENAI_API_KEY="sk-..." \
  --from-literal=TELEGRAM_BOT_TOKEN="..." \
  --from-literal=GROQ_API_KEY="..." \
  -n edith
```

## Install (staging)

```bash
helm upgrade --install edith ./k8s/helm \
  --namespace edith --create-namespace
```

## Install (production)

```bash
helm upgrade --install edith ./k8s/helm \
  -f k8s/helm/values.prod.yaml \
  --set image.tag=<git-sha> \
  --namespace edith --create-namespace
```

## Uninstall

```bash
helm uninstall edith -n edith
```

## Scaling

Horizontal Pod Autoscaler is configured in `values.prod.yaml` (2–10 replicas, CPU 65% / memory 75%). Enable it by setting `autoscaling.enabled: true`.

## Persistence

SQLite database and workspace files are stored in a `PersistentVolumeClaim` mounted at `/app/data`. Set `persistence.storageClass` to a storage class available in your cluster.

> **Note:** SQLite with `ReadWriteOnce` PVC means only a single pod can write at a time. If you scale beyond 1 replica, configure a PostgreSQL-backed `DATABASE_URL` via the secrets instead.
