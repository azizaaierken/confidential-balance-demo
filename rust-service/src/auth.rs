//! Minimal password-based auth for the demo: one password per role, checked
//! server-side, exchanged for an opaque bearer token held in memory. This is
//! deliberately simple (no user accounts, no hashing scheme, no persistence)
//! — the point is that sensitive endpoints and confidential fields are no
//! longer wide open to anyone who can reach the HTTP port, not that this is a
//! production auth system.
//!
//! The frontend holds up to three tokens at once (sender / receiver /
//! auditor, however many it has unlocked) and sends every one it currently
//! holds on every request via a single `X-Auth-Tokens: t1,t2,...` header —
//! that one header both authorizes the specific action a handler needs and
//! determines how much of `/state` the response reveals, so a session that's
//! unlocked as both an owner and the auditor sees both at once.

use anyhow::{anyhow, Result};
use axum::http::HeaderMap;
use solana_sdk::signature::Keypair;
use std::collections::HashMap;
use std::sync::RwLock;

const TOKEN_TTL_MS: i64 = 4 * 60 * 60 * 1000; // 4 hours

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Role {
    OwnerSender,
    OwnerReceiver,
    Auditor,
}

impl Role {
    pub fn parse(s: &str) -> Result<Role> {
        match s {
            "sender" => Ok(Role::OwnerSender),
            "receiver" => Ok(Role::OwnerReceiver),
            "auditor" => Ok(Role::Auditor),
            other => Err(anyhow!("unknown role: {other}")),
        }
    }

    fn owner_account_id(self) -> Option<&'static str> {
        match self {
            Role::OwnerSender => Some("sender"),
            Role::OwnerReceiver => Some("receiver"),
            Role::Auditor => None,
        }
    }
}

pub struct AuthRegistry {
    passwords: HashMap<&'static str, String>,
    tokens: RwLock<HashMap<String, (Role, i64)>>,
}

fn env_password(var: &str, demo_default: &str) -> String {
    std::env::var(var).unwrap_or_else(|_| demo_default.to_string())
}

impl Default for AuthRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthRegistry {
    pub fn new() -> Self {
        let mut passwords = HashMap::new();
        passwords.insert(
            "sender",
            env_password("OWNER_SENDER_PASSWORD", "sender-demo"),
        );
        passwords.insert(
            "receiver",
            env_password("OWNER_RECEIVER_PASSWORD", "receiver-demo"),
        );
        passwords.insert("auditor", env_password("AUDITOR_PASSWORD", "auditor-demo"));

        tracing::info!(
            "demo auth passwords (override via env vars for anything beyond a local demo):"
        );
        tracing::info!(
            "  sender:   {} (OWNER_SENDER_PASSWORD)",
            passwords["sender"]
        );
        tracing::info!(
            "  receiver: {} (OWNER_RECEIVER_PASSWORD)",
            passwords["receiver"]
        );
        tracing::info!("  auditor:  {} (AUDITOR_PASSWORD)", passwords["auditor"]);

        Self {
            passwords,
            tokens: RwLock::new(HashMap::new()),
        }
    }

    fn role_key(role: Role) -> &'static str {
        match role {
            Role::OwnerSender => "sender",
            Role::OwnerReceiver => "receiver",
            Role::Auditor => "auditor",
        }
    }

    pub fn check_password(&self, role: Role, password: &str) -> bool {
        self.passwords
            .get(Self::role_key(role))
            .is_some_and(|expected| expected == password)
    }

    pub fn login(&self, role: Role, password: &str, now_ms: i64) -> Result<String> {
        if !self.check_password(role, password) {
            return Err(anyhow!("wrong password"));
        }
        let token = hex::encode(Keypair::new().to_bytes());
        self.tokens
            .write()
            .unwrap()
            .insert(token.clone(), (role, now_ms + TOKEN_TTL_MS));
        Ok(token)
    }

    fn token_role(&self, token: &str, now_ms: i64) -> Option<Role> {
        let tokens = self.tokens.read().unwrap();
        let (role, expires_at) = tokens.get(token)?;
        if *expires_at < now_ms {
            return None;
        }
        Some(*role)
    }

    /// Every role this request is currently authorized for, resolved from the
    /// `X-Auth-Tokens` header (comma-separated tokens; unknown/expired ones
    /// are silently ignored rather than failing the whole request).
    pub fn roles_for(&self, headers: &HeaderMap, now_ms: i64) -> Vec<Role> {
        let Some(raw) = headers.get("x-auth-tokens").and_then(|v| v.to_str().ok()) else {
            return Vec::new();
        };
        raw.split(',')
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .filter_map(|t| self.token_role(t, now_ms))
            .collect()
    }
}

pub fn require_owner(roles: &[Role], account_id: &str) -> Result<()> {
    if roles
        .iter()
        .any(|r| r.owner_account_id() == Some(account_id))
    {
        Ok(())
    } else {
        Err(anyhow!(
            "not authorized as the owner of accountId {account_id} — unlock owner access first"
        ))
    }
}

pub fn require_auditor(roles: &[Role]) -> Result<()> {
    if roles.contains(&Role::Auditor) {
        Ok(())
    } else {
        Err(anyhow!(
            "not authorized as auditor — unlock auditor access first"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn registry() -> AuthRegistry {
        AuthRegistry::new()
    }

    fn headers(tokens: &[&str]) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(
            "x-auth-tokens",
            HeaderValue::from_str(&tokens.join(",")).unwrap(),
        );
        h
    }

    #[test]
    fn login_rejects_wrong_password() {
        let r = registry();
        assert!(r.login(Role::Auditor, "nope", 0).is_err());
    }

    #[test]
    fn token_resolves_to_its_role_until_expiry() {
        let r = registry();
        let t = r.login(Role::OwnerSender, "sender-demo", 1_000).unwrap();
        assert_eq!(r.roles_for(&headers(&[&t]), 1_000), vec![Role::OwnerSender]);
        assert_eq!(
            r.roles_for(&headers(&[&t]), 1_000 + TOKEN_TTL_MS + 1),
            Vec::<Role>::new()
        );
    }

    #[test]
    fn several_tokens_combine_and_unknown_ones_are_ignored() {
        let r = registry();
        let s = r.login(Role::OwnerSender, "sender-demo", 0).unwrap();
        let a = r.login(Role::Auditor, "auditor-demo", 0).unwrap();
        let roles = r.roles_for(&headers(&[&s, "garbage", &a]), 0);
        assert!(roles.contains(&Role::OwnerSender));
        assert!(roles.contains(&Role::Auditor));
        assert!(!roles.contains(&Role::OwnerReceiver));
    }

    #[test]
    fn owner_check_is_per_account() {
        assert!(require_owner(&[Role::OwnerSender], "sender").is_ok());
        assert!(require_owner(&[Role::OwnerSender], "receiver").is_err());
        assert!(require_owner(&[Role::Auditor], "sender").is_err());
        assert!(require_owner(&[], "sender").is_err());
    }

    #[test]
    fn auditor_check_requires_auditor_role() {
        assert!(require_auditor(&[Role::Auditor]).is_ok());
        assert!(require_auditor(&[Role::OwnerSender, Role::OwnerReceiver]).is_err());
    }
}
