# Memory Schema — Orion

> Database and vector store schema documentation.

---

## PostgreSQL Tables (SQLAlchemy ORM)

### users
| Column     | Type     | Description                |
|------------|----------|----------------------------|
| id         | String   | Primary key — user ID      |
| name       | String   | User display name          |
| created_at | DateTime | Account creation timestamp  |
| settings   | JSON     | User preferences and config|

### messages
| Column     | Type     | Description                |
|------------|----------|----------------------------|
| id         | Integer  | Auto-increment primary key |
| user_id    | String   | FK → users.id              |
| role       | String   | "user", "assistant", "system" |
| content    | Text     | Message content            |
| metadata   | JSON     | Extra data (engine, etc.)  |
| thread_id  | String   | FK → threads.id (nullable) |
| created_at | DateTime | Message timestamp          |

### threads
| Column     | Type     | Description                |
|------------|----------|----------------------------|
| id         | String   | Primary key — thread ID    |
| user_id    | String   | FK → users.id              |
| trigger    | String   | What initiated this thread |
| state      | String   | "open", "waiting", "resolved" |
| created_at | DateTime | Thread creation timestamp   |
| updated_at | DateTime | Last state change timestamp |

### compressed_memories
| Column                 | Type     | Description                  |
|------------------------|----------|------------------------------|
| id                     | Integer  | Auto-increment primary key   |
| user_id                | String   | FK → users.id                |
| summary                | Text     | Compressed memory summary    |
| original_message_count | Integer  | Number of messages compressed |
| date_range_start       | DateTime | Start of compressed period   |
| date_range_end         | DateTime | End of compressed period     |
| created_at             | DateTime | Compression timestamp        |

### trigger_logs
| Column       | Type     | Description                |
|--------------|----------|----------------------------|
| id           | Integer  | Auto-increment primary key |
| user_id      | String   | FK → users.id              |
| trigger_type | String   | Type of trigger fired      |
| reason       | Text     | Why the trigger was fired  |
| urgency      | String   | "low", "medium", "high", "critical" |
| acted_on     | Boolean  | Whether action was taken   |
| created_at   | DateTime | Trigger timestamp          |

---

## Vector Store Schema

### Index: orion-memory
| Field    | Type       | Description              |
|----------|------------|--------------------------|
| id       | String     | Document/message ID      |
| vector   | Float[1536]| Embedding vector         |
| text     | String     | Original text content    |
| user_id  | String     | Owner of this memory     |
| timestamp| String     | ISO 8601 timestamp       |
| source   | String     | "message", "summary", etc|

---

*Update this document when schema changes.*
