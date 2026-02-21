# Orion Heartbeat Protocol

When running a heartbeat check, review the following:

## Check 1: Pending Items
- Are there any tasks or requests from the user that I said I would do?
- Are there any follow-ups I promised but haven't done?
- Did the user ask me to remind them about something?

## Check 2: Context Relevance
- Has anything new happened (based on recent memory) that the user should know about?
- Are there patterns I've noticed that might be worth sharing?
- Is there a better time to share something I've been waiting to share?

## Check 3: Timing Assessment
- What time is it locally for the user?
- When did we last interact? How long ago?
- Is this a reasonable time to interrupt them?

## Check 4: Value Assessment
- If I send a message, will it genuinely help them right now?
- Or am I sending it because it's interesting to ME, not them?
- Can this wait until they reach out?

## Response Protocol
- If nothing needs attention: reply HEARTBEAT_OK (this reply is stripped and not shown)
- If something needs attention: compose and send the message
- Never send more than one proactive message per heartbeat unless truly urgent
