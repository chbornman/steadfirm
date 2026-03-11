use std::net::SocketAddr;

use axum::{extract::DefaultBodyLimit, middleware as axum_mw, routing::get, Json, Router};
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

mod auth;
mod config;
pub mod constants;
mod error;
mod middleware;
mod models;
mod pagination;
pub mod provisioning;
mod proxy;
mod routes;
mod services;
mod startup;

/// Shared application state available to all route handlers.
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::PgPool,
    pub config: config::Config,
    pub http: reqwest::Client,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "steadfirm_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    dotenvy::dotenv().ok();

    let mut config = config::Config::from_env()?;

    // Connect to Postgres
    let pool = PgPoolOptions::new()
        .max_connections(config.db_max_connections)
        .connect(&config.database_url)
        .await?;
    tracing::info!("connected to database");

    // Run SQLx migrations
    sqlx::migrate!().run(&pool).await?;
    tracing::info!("database migrations applied");

    // Shared HTTP client for all service calls
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(config.http_timeout_secs))
        .connect_timeout(std::time::Duration::from_secs(
            config.http_connect_timeout_secs,
        ))
        .build()?;

    // Load any existing admin credentials from DB
    config = startup::load_admin_credentials(&pool, config).await?;

    // Initialize services that haven't been set up yet
    startup::initialize_services(&pool, &mut config, &http).await?;
    tracing::info!("service initialization complete");

    // Ensure files storage directory exists
    std::fs::create_dir_all(&config.files_storage_path)?;

    let state = AppState {
        db: pool,
        config: config.clone(),
        http,
    };

    let app = Router::new()
        .route("/health", get(health))
        .nest("/api/v1", routes::api_router())
        .layer(DefaultBodyLimit::max(state.config.max_upload_bytes))
        .layer(axum_mw::from_fn(middleware::request_id))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    tracing::info!("Steadfirm backend listening on {addr}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "steadfirm",
        "version": env!("CARGO_PKG_VERSION")
    }))
}
