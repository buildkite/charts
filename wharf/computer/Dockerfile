FROM ubuntu:24.04
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git python3 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /home/bot
CMD ["sleep", "infinity"]
