#!/bin/sh
set -e
ollama serve &
PID=$!
until ollama list >/dev/null 2>&1; do sleep 1; done
ollama pull "${GEMMA_MODEL:-gemma4:e2b}"
echo "the keeper is awake: ${GEMMA_MODEL:-gemma4:e2b}"
wait $PID
