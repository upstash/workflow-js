#!/bin/bash

CLERK_API_KEY="API_KEY"


RANDOM_NUM=$(( RANDOM % 9000 + 1000 ))
EXTERNAL_ID_NUM=$(( RANDOM % 9000 + 1000 ))

# Get current date in ISO 8601 format
CURRENT_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Create JSON payload with unverified email
curl -X POST "https://api.clerk.com/v1/users" \
  -H "Authorization: Bearer ${CLERK_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "external_id": "user'"${EXTERNAL_ID_NUM}"'",
    "first_name": "John",
    "last_name": "Doe",
    "email_address": [
      "john.doe'"${RANDOM_NUM}"'@example.com"
    ],
    "skip_password_requirement": true,
    "public_metadata": {
      "role": "user",
      "plan": "free"
    },
    "created_at": "'"${CURRENT_DATE}"'"
  }'