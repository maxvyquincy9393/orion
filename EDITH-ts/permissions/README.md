# Triggers Configuration

EDITH reads proactive trigger rules from `permissions/triggers.yaml`.

## Default State

By default, the file contains:

```yaml
[]
```

An empty list means no proactive triggers are active.

## Trigger Item Shape

Each item follows this structure:

```yaml
- id: morning-checkin
  name: Morning Check-In
  type: scheduled
  enabled: true
  priority: normal
  schedule: "0 9 * * *"
  message: "Good morning! Review your top tasks."
  userId: owner
```
