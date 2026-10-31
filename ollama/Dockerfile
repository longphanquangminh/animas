# The keeper: Ollama serving Gemma 4 (open weights). Pulls the model on first boot.
FROM ollama/ollama:latest
ENV OLLAMA_HOST=0.0.0.0:11434 OLLAMA_MODELS=/root/.ollama/models OLLAMA_KEEP_ALIVE=24h
ENV OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
