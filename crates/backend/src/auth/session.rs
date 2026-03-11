use sqlx::PgPool;

/// Raw session + user data from the BetterAuth tables.
#[derive(sqlx::FromRow)]
pub struct SessionUser {
    pub user_id: String,
    pub name: String,
    pub email: String,
}

/// Validate a session token by reading BetterAuth's session table directly.
/// Returns the associated user if the session is valid and not expired.
pub async fn validate_session(
    pool: &PgPool,
    token: &str,
) -> Result<Option<SessionUser>, sqlx::Error> {
    let row = sqlx::query_as::<_, SessionUser>(
        r#"
        SELECT s."userId" as user_id,
               u.name,
               u.email
        FROM session s
        JOIN "user" u ON s."userId" = u.id
        WHERE s.token = $1
          AND s."expiresAt" > now()
        "#,
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;

    Ok(row)
}

/// Service credential for a specific service.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ServiceCredRow {
    pub service: String,
    pub service_user_id: String,
    pub api_key: String,
}

/// Load all active service credentials for a user.
pub async fn load_credentials(
    pool: &PgPool,
    user_id: &str,
) -> Result<Vec<ServiceCredRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, ServiceCredRow>(
        r#"
        SELECT service, service_user_id, api_key
        FROM service_connections
        WHERE user_id = $1 AND active = true
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}
