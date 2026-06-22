# Build from the repository root:
#   docker build -f services/sync/Dockerfile -t joessh-sync:0.1.0-beta.4 .

FROM rust:1-bookworm AS build
WORKDIR /src

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY services/sync ./services/sync

RUN cargo build --release -p atlasterm-sync --locked

FROM debian:bookworm-slim
RUN useradd --system --home /var/lib/joessh-sync --create-home --shell /usr/sbin/nologin joessh \
  && apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/target/release/atlasterm-sync /usr/local/bin/joessh-sync

ENV ATLASTERM_SYNC_BIND=0.0.0.0:4100
ENV ATLASTERM_SYNC_STORAGE_PATH=/var/lib/joessh-sync/ledger.json
VOLUME ["/var/lib/joessh-sync"]
EXPOSE 4100
USER joessh

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD curl -fsS "http://127.0.0.1:${ATLASTERM_SYNC_HEALTHCHECK_PORT:-4100}/healthz" || exit 1

ENTRYPOINT ["/usr/local/bin/joessh-sync"]
