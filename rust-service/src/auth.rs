//! Demo role selection. There is no authentication in this demo: the
//! frontend tells the backend which roles the viewer has switched on (any
//! combination of the sender, the receiver and the auditor) via a single
//! `X-Demo-Roles: sender,auditor` header, and the backend reveals exactly
//! what that combination is entitled to see and permits exactly the actions
//! those roles may take.
//!
//! That header is a UI switch, not a credential — anyone who can reach the
//! HTTP port can set it. What this buys is fidelity, not security: every
//! redaction and permission decision is still made server-side, in one
//! place, from the roles a request presents, so the demo shows the real
//! shape of who-sees-what. A production deployment would replace the header
//! with authenticated sessions and keep the rest of this module as is. The
//! service is expected to be reachable only from the machine running the
//! demo; see `BIND_ADDR` and `CORS_ORIGINS` in `bin/server.rs`.

use anyhow::{anyhow, Result};
use axum::http::HeaderMap;

pub const ROLES_HEADER: &str = "x-demo-roles";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Role {
    OwnerSender,
    OwnerReceiver,
    Auditor,
}

impl Role {
    pub fn parse(s: &str) -> Option<Role> {
        match s {
            "sender" => Some(Role::OwnerSender),
            "receiver" => Some(Role::OwnerReceiver),
            "auditor" => Some(Role::Auditor),
            _ => None,
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

/// Every role this request is viewing as, from the `X-Demo-Roles` header
/// (comma-separated; unknown names are ignored rather than failing the
/// request). No header means a public observer.
pub fn roles_for(headers: &HeaderMap) -> Vec<Role> {
    let Some(raw) = headers.get(ROLES_HEADER).and_then(|v| v.to_str().ok()) else {
        return Vec::new();
    };
    let mut roles: Vec<Role> = raw
        .split(',')
        .map(str::trim)
        .filter_map(Role::parse)
        .collect();
    roles.dedup();
    roles
}

pub fn require_owner(roles: &[Role], account_id: &str) -> Result<()> {
    if roles
        .iter()
        .any(|r| r.owner_account_id() == Some(account_id))
    {
        Ok(())
    } else {
        Err(anyhow!(
            "not viewing as the owner of accountId {account_id} — switch to its owner view first"
        ))
    }
}

pub fn require_auditor(roles: &[Role]) -> Result<()> {
    if roles.contains(&Role::Auditor) {
        Ok(())
    } else {
        Err(anyhow!(
            "not viewing as the auditor — switch the auditor view on first"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(value: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(ROLES_HEADER, HeaderValue::from_str(value).unwrap());
        h
    }

    #[test]
    fn no_header_means_public_observer() {
        assert!(roles_for(&HeaderMap::new()).is_empty());
    }

    #[test]
    fn parses_any_combination_and_ignores_unknown_names() {
        let roles = roles_for(&headers(" sender, auditor ,garbage,"));
        assert_eq!(roles, vec![Role::OwnerSender, Role::Auditor]);
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
