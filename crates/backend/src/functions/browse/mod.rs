//! Browse — show what's in each service through a unified UI.
//!
//! Each sub-module proxies requests to one backing service, transforming
//! responses into Steadfirm's unified models.

pub mod audiobooks;
pub mod documents;
pub mod files;
pub mod media;
pub mod photos;
pub mod reading;
