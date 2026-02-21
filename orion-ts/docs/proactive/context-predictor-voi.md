# Context Predictor and VoI

Files:
- `src/core/context-predictor.ts`
- `src/core/voi.ts`

## MultiDimContext
- conversationRecency (hours)
- conversationFrequency (messages/day recent window)
- channelActivity (0-1)
- typicalActiveHour (boolean)
- recentTopics (tokens)
- urgencySignals (keywords)

## VoI Formula
`VoI = P(user_benefits) * benefit_value - action_cost - disturbance_cost`

## Probability Adjustments
- Base from trigger priority.
- Bonus when current hour is typical active time.
- Bonus for high channel activity.
- Bonus for urgency signals.

## Disturbance Cost
- Low if user is currently active.
- High outside active hour or during quiet periods.
- Elevated when user was inactive for long interval.

## Daemon Integration
- Predictor run before proactive send.
- VoI gate decides send vs skip and logs reasoning.
