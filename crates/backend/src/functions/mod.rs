//! High-level features — the business logic of Steadfirm.
//!
//! Each module is a user-facing capability that orchestrates across
//! backing services and optionally uses LLMs for intelligent input.
//!
//! See `specs/REFACTOR.md` for the full architecture rationale.

pub mod browse;
pub mod classify;
pub mod metadata;
pub mod search;
pub mod upload;
